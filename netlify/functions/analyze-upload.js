import { getStore } from '@netlify/blobs';
import { google } from 'googleapis';
import xlsx from 'xlsx';
import { GoogleGenerativeAI } from '@google/generative-ai';
import referenceData from '../../data/reference.json' assert { type: 'json' };

const referenceEntries = Object.entries(referenceData).map(([section, rawValue]) => {
  if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
    const { value, ...rest } = rawValue;
    return { section, expected: value ?? '', extras: rest };
  }

  return { section, expected: rawValue ?? '', extras: {} };
});

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
      value: rawValue ?? '',
      notes: rawNotes ?? '',
    });
  }

  return userEntries;
};

// Strict validation and batching configuration
const MAX_MESSAGE_LEN = 160;
const BATCH_SIZE = 15; // keep batches small to avoid output truncation

const clampScore = (n) => {
  const num = Number(n);
  if (Number.isNaN(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
};

const truncate = (s, max = MAX_MESSAGE_LEN) => {
  const str = String(s || '');
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
};

const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const buildStrictPromptForBatch = ({ batchRefs, userExcelText }) => {
  const referenceItems = batchRefs
    .map((ref, index) => {
      return `${index + 1}. Section attendue: "${ref.section}"
   Valeur attendue: "${ref.expected}"
   ${ref.extras && Object.keys(ref.extras).length > 0 ? `Infos complémentaires: ${JSON.stringify(ref.extras)}` : ''}`;
    })
    .join('\n\n');

  const prompt = `Tu es un auditeur ULTRA-STRICT en conformité de sécurité chantier. Compare chaque section UTILISATEUR au RÉFÉRENTIEL.

RÈGLE ABSOLUE: seule la reformulation lexicale est tolérée. Toute différence de SENS/FAIT/EXIGENCE/PORTÉE/STATUT = score 0%.

RÉFÉRENTIEL (${batchRefs.length} items, ordre à respecter strictement):
${referenceItems}

FICHIER EXCEL UTILISATEUR (sections/valeurs telles que détectées):
${userExcelText}

Consignes de sortie STRICTES:
- RENDS EXACTEMENT ${batchRefs.length} objets dans "items".
- UN OBJET PAR SECTION du référentiel, dans le MÊME ORDRE, et COPIE "section" À L’IDENTIQUE (mêmes caractères).
- Pour chaque objet, fournis uniquement les champs: section, score, message, userValue.
- Si la section n’existe pas ou ne correspond pas strictement au référentiel côté utilisateur: userValue="", score=0, message="Information absente".
- Limite "message" à 120 caractères, clair et factuel.
- N’AJOUTE AUCUN AUTRE CHAMP, AUCUN TEXTE HORS JSON, PAS DE "...".

Grille de scoring (rappel condensé):
- 0%: fait/statut/portée/procédure opposés ou élément critique manquant
- 95–100%: équivalence stricte de sens et de faits (synonymes OK)

RÉPONSE ATTENDUE (JSON strict UNIQUEMENT - EXEMPLE SCHÉMATIQUE):
{
  "items": [
    { "section": "${batchRefs[0].section}", "score": 100, "message": "Conforme", "userValue": "…" }
  ]
}`;

  return prompt;
};

const parseJsonObjectFromText = (text) => {
  const jsonMatch = String(text || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (_) {
    return null;
  }
};

const validateAndNormalizeBatch = ({ expectedSections, json }) => {
  const out = [];
  const items = Array.isArray(json?.items) ? json.items : [];

  for (let i = 0; i < expectedSections.length; i++) {
    const expectedSection = expectedSections[i];
    const item = items.find((it) => it && it.section === expectedSection);

    if (!item) {
      out.push({
        section: expectedSection,
        score: 0,
        message: 'Non analysé (ajout auto)',
        userValue: '',
      });
      continue;
    }

    out.push({
      section: expectedSection,
      score: clampScore(item.score),
      message: truncate(item.message || ''),
      userValue: String(item.userValue || ''),
    });
  }

  return out;
};

const buildComparisonWithGemini = async (userEntries) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY non configurée');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  // Représentation texte de l'Excel utilisateur
  const userExcelText = userEntries
    .map((entry) => `"${entry.section}": "${entry.value}"`)
    .join('\n');

  const batches = chunkArray(referenceEntries, BATCH_SIZE);
  const allItems = [];

  for (const batchRefs of batches) {
    const expectedSections = batchRefs.map((r) => r.section);
    const prompt = buildStrictPromptForBatch({ batchRefs, userExcelText });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    const json = parseJsonObjectFromText(text);

    const normalized = validateAndNormalizeBatch({ expectedSections, json });
    for (let i = 0; i < normalized.length; i++) {
      const norm = normalized[i];
      const ref = batchRefs[i];
      allItems.push({
        section: norm.section,
        score: clampScore(norm.score),
        message: truncate(norm.message || ''),
        expectedSnippet: ref.expected || '',
        receivedSnippet: String(norm.userValue || ''),
      });
    }
  }

  // Contrôle de complétude global; ajout de garde-fous si besoin
  if (allItems.length !== referenceEntries.length) {
    const expectedSet = new Set(referenceEntries.map((r) => r.section));
    const seenSet = new Set(allItems.map((i) => i.section));
    for (const ref of referenceEntries) {
      if (!seenSet.has(ref.section)) {
        allItems.push({
          section: ref.section,
          score: 0,
          message: 'Non analysé (ajout auto)',
          expectedSnippet: ref.expected || '',
          receivedSnippet: '',
        });
      }
    }
  }

  const totalScore = allItems.reduce((sum, item) => sum + clampScore(item.score), 0);
  const avgScore = allItems.length > 0 ? totalScore / allItems.length : 0;

  allItems.sort((a, b) => a.score - b.score);

  return {
    score: Number(avgScore.toFixed(1)),
    details: allItems,
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
    const comparison = await buildComparisonWithGemini(userEntries);

    const summaryItems = comparison.details
      .slice(0, 5)
      .map((issue) => {
        const scoreLabel = issue.score !== undefined ? `${issue.score}%` : 'n.c.';
        return `${issue.section} (${scoreLabel}) → ${issue.message}`;
      });

    const summary = summaryItems.length
      ? summaryItems.join(' | ')
      : 'Aucun écart significatif détecté.';

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
