import { getStore } from '@netlify/blobs';
import { google } from 'googleapis';
import xlsx from 'xlsx';
import referenceData from '../../data/reference.json' assert { type: 'json' };

const referenceEntries = Object.entries(referenceData).map(([section, rawValue]) => {
  if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
    const { value, ...rest } = rawValue;
    return { section, expected: value ?? '', extras: rest };
  }

  return { section, expected: rawValue ?? '', extras: {} };
});

const normalizeText = (input) => {
  if (input === undefined || input === null) {
    return '';
  }
  return String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const levenshtein = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
};

const similarityScore = (expected, received) => {
  const normExpected = normalizeText(expected);
  const normReceived = normalizeText(received);

  if (!normExpected && !normReceived) return 100;
  if (normExpected && !normReceived) return 0;
  if (!normExpected && normReceived) return 40;

  const distance = levenshtein(normExpected, normReceived);
  const base = Math.max(normExpected.length, normReceived.length) || 1;
  const ratio = 1 - distance / base;
  return Math.max(0, Math.min(1, ratio)) * 100;
};

const parseUserWorkbook = (buffer) => {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Le fichier ne contient aucune feuille Excel exploitable.');
  }
  const worksheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  const [headerRow, ...dataRows] = rows;
  if (!headerRow || headerRow.length === 0) {
    throw new Error('La première ligne doit contenir au minimum la colonne dédiée aux sections.');
  }

  const userEntries = [];
  for (const row of dataRows) {
    if (!row || row.length === 0) continue;
    const [rawSection, rawValue, rawNotes] = row;
    const sectionLabel = String(rawSection || '').trim();
    if (!sectionLabel) continue;
    userEntries.push({
      section: sectionLabel,
      normalizedSection: normalizeText(sectionLabel),
      value: rawValue ?? '',
      notes: rawNotes ?? '',
    });
  }

  return userEntries;
};

const buildComparison = (userEntries) => {
  const issues = [];
  let cumulatedScore = 0;

  const unmatchedUserEntries = new Set(userEntries.map((entry, index) => index));

  referenceEntries.forEach(({ section, expected, extras }) => {
    const normalizedTarget = normalizeText(section);
    let bestMatch = null;
    let bestScore = 0;

    userEntries.forEach((entry, index) => {
      const keyScore = similarityScore(normalizedTarget, entry.normalizedSection);
      if (keyScore > bestScore) {
        bestScore = keyScore;
        bestMatch = { ...entry, index };
      }
    });

    if (!bestMatch || bestScore < 60) {
      issues.push({
        section,
        score: 0,
        message: "Information absente ou mal identifiée dans le fichier fourni.",
        expectedSnippet: expected,
        receivedSnippet: '',
      });
      return;
    }

    unmatchedUserEntries.delete(bestMatch.index);

    const fieldScore = similarityScore(expected, bestMatch.value);
    cumulatedScore += fieldScore;

    if (fieldScore < 70) {
      issues.push({
        section,
        score: Number(fieldScore.toFixed(1)),
        message: 'Contenu incomplet ou divergences significatives par rapport à la référence.',
        expectedSnippet: expected,
        receivedSnippet: bestMatch.value,
      });
    } else if (fieldScore < 90) {
      issues.push({
        section,
        score: Number(fieldScore.toFixed(1)),
        message: 'Informations partiellement conformes (vérifier les détails et la formulation).',
        expectedSnippet: expected,
        receivedSnippet: bestMatch.value,
      });
    }

    if (extras && Object.keys(extras).length > 0) {
      const expectedExtras = Object.entries(extras)
        .map(([key, value]) => `${key}: ${value}`)
        .join(' | ');
      issues.push({
        section: `${section} — éléments complémentaires`,
        score: fieldScore >= 80 ? 100 : Number(fieldScore.toFixed(1)),
        message: `Attendu également: ${expectedExtras}`,
        expectedSnippet: expectedExtras,
        receivedSnippet: '',
      });
    }
  });

  const completenessScore = (cumulatedScore / referenceEntries.length) || 0;

  if (unmatchedUserEntries.size > 0) {
    unmatchedUserEntries.forEach((index) => {
      const entry = userEntries[index];
      issues.push({
        section: entry.section,
        score: 50,
        message: "Section non reconnue dans la référence. Vérifiez l'intitulé ou l'association.",
        expectedSnippet: '',
        receivedSnippet: entry.value,
      });
    });
  }

  issues.sort((a, b) => a.score - b.score);

  return {
    score: Number(completenessScore.toFixed(1)),
    details: issues,
  };
};

const formatDuration = (ms) => {
  if (!ms || Number.isNaN(Number(ms))) {
    return 'Durée non disponible';
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const storeUploadedFile = async (fileName, buffer, metadata) => {
  try {
    const store = getStore({ name: 'cosep-uploads' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `reports/${timestamp}-${fileName.replace(/\s+/g, '-')}`;
    await store.set(key, buffer, { metadata });
    return { success: true, location: key };
  } catch (error) {
    console.warn('Stockage Netlify Blobs indisponible:', error.message);
    return { success: false, message: "Impossible d'archiver le fichier (fonctionnalité indisponible)." };
  }
};

const appendToGoogleSheet = async ({
  firstName,
  lastName,
  elapsedMs,
  score,
  summary,
  submittedAt,
}) => {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, '\n');
  const sheetId = process.env.GOOGLE_SHEETS_ID;

  if (!clientEmail || !privateKey || !sheetId) {
    return {
      success: false,
      message: 'Variables Google Sheets manquantes. Résultat non archivé côté Google.',
    };
  }

  try {
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const durationMinutes = elapsedMs / 60000;
    const formattedDuration = `${Math.floor(durationMinutes)} min ${(Math.round((durationMinutes % 1) * 60))
      .toString()
      .padStart(2, '0')} s`;

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [
            new Date(submittedAt).toISOString(),
            firstName,
            lastName,
            formattedDuration,
            Number(score.toFixed(1)),
            summary,
          ],
        ],
      },
    });

    return {
      success: true,
      message: 'Résultat archivé dans Google Sheets.',
    };
  } catch (error) {
    console.error('Erreur Google Sheets:', error.message);
    return { success: false, message: `Echec archivage Google Sheets: ${error.message}` };
  }
};

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Méthode non autorisée.' };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const { firstName, lastName, fileName, fileContent, elapsedMs, startedAt, submittedAt } = payload;

    if (!firstName || !lastName) {
      return { statusCode: 400, body: 'Les champs prénom et nom sont obligatoires.' };
    }

    if (!fileName || !fileContent) {
      return { statusCode: 400, body: 'Aucun fichier reçu pour analyse.' };
    }

    const buffer = Buffer.from(fileContent, 'base64');
    const userEntries = parseUserWorkbook(buffer);
    const comparison = buildComparison(userEntries);

    const summary =
      comparison.details
        .slice(0, 3)
        .map((issue) => `${issue.section}: ${issue.message}`)
        .join(' | ') || 'Aucun écart significatif détecté.';

    const storage = await storeUploadedFile(fileName, buffer, {
      firstName,
      lastName,
      submittedAt,
      score: comparison.score,
    });

    const sheetResult = await appendToGoogleSheet({
      firstName,
      lastName,
      elapsedMs,
      score: comparison.score,
      summary,
      submittedAt,
    });

    const responsePayload = {
      score: comparison.score,
      elapsed: {
        ms: elapsedMs,
        formatted: formatDuration(elapsedMs),
        startedAt,
        submittedAt,
      },
      details: comparison.details.map((issue) => ({
        section: issue.section,
        score: issue.score,
        message: issue.message,
        expected: issue.expectedSnippet,
        received: issue.receivedSnippet,
      })),
      storage,
      sheet: sheetResult,
    };

    return {
      statusCode: 200,
      body: JSON.stringify(responsePayload),
    };
  } catch (error) {
    console.error('Erreur dans la fonction analyze-upload:', error);
    return { statusCode: 500, body: `Erreur serveur: ${error.message}` };
  }
};
