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

const buildComparisonWithGemini = async (userEntries) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY non configurée');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  // Construire une représentation texte de l'Excel utilisateur
  const userExcelText = userEntries
    .map((entry) => `"${entry.section}": "${entry.value}"`)
    .join('\n');

  // Construire la liste des items de référence
  const referenceItems = referenceEntries
    .map((ref, index) => {
      return `${index + 1}. Section attendue: "${ref.section}"
   Valeur attendue: "${ref.expected}"
   ${ref.extras && Object.keys(ref.extras).length > 0 ? `Infos complémentaires: ${JSON.stringify(ref.extras)}` : ''}`;
    })
    .join('\n\n');

  const prompt = `Tu es un auditeur ULTRA-STRICT en conformité de sécurité chantier. Tu dois vérifier si un fichier Excel utilisateur contient EXACTEMENT les mêmes informations factuelles que le RÉFÉRENTIEL.

**RÈGLE ABSOLUE** : Seule la reformulation LEXICALE est autorisée (synonymes). Toute différence de SENS, de FAIT, d'EXIGENCE ou de STATUT = score 0%.

RÉFÉRENTIEL (${referenceEntries.length} items obligatoires):
${referenceItems}

FICHIER EXCEL UTILISATEUR:
${userExcelText}

GRILLE DE SCORING ULTRA-STRICTE:

**Score 0% (NON-CONFORME TOTAL):**
- Information ABSENTE
- Information OPPOSÉE sur les faits (ex: "Non signalée" ≠ "Présence confirmée")
- Changement de STATUT (ex: "Obligatoire" ≠ "Recommandé", "Interdit" ≠ "Autorisé")
- Changement de PROCÉDURE (ex: "Séparé" ≠ "Centralisé", "Étanche" ≠ "Sol nu")
- Changement de PORTÉE (ex: "En tout temps" ≠ "Phases critiques seulement")
- Information INCOMPLÈTE sur un élément de sécurité CRITIQUE

**Score 95-100% (CONFORME):**
- Information IDENTIQUE au niveau du sens ET des faits
- Reformulation lexicale acceptée UNIQUEMENT si le sens est strictement identique
- Exemples acceptables:
  * "Description sommaire du chantier" ≈ "Aperçu général des travaux" (même concept, aucune info perdue)
  * "Sans objet" ≈ "N/A" ≈ "Non applicable" (strictement équivalent)
  * "Port du casque obligatoire en tout temps" ≈ "Casque requis en permanence" (même obligation, même portée)

EXEMPLES DE SCORING (À SUIVRE ABSOLUMENT):

EXEMPLE 1 - Score 0%:
- Référence: "Port du casque, gilet fluorescent et chaussures de sécurité obligatoire en tout temps."
- Utilisateur: "Équipements recommandés uniquement lors des phases critiques."
- Score: 0% (obligatoire ≠ recommandé, tout temps ≠ phases critiques = changement de statut ET de portée)
- Message: "Non-conformité totale: obligations de sécurité remplacées par recommandations ponctuelles"

EXEMPLE 2 - Score 0%:
- Référence: "Gestion séparée des huiles, carburants et bétons ; zone de remplissage étanche."
- Utilisateur: "Gestion centralisée sans séparation des produits ; stockage temporaire sur sol nu."
- Score: 0% (séparée ≠ centralisée, étanche ≠ sol nu = procédures opposées)
- Message: "Non-conformité totale: procédure de séparation ignorée, zone étanche absente"

EXEMPLE 3 - Score 0%:
- Référence: "Non signalée dans les documents. Vigilance en cas de découverte fortuite (procédure stop-work)."
- Utilisateur: "Présence confirmée selon rapport externe. Vigilance en cas de découverte fortuite (procédure stop-work)."
- Score: 0% (Non signalée ≠ Présence confirmée = FAITS OPPOSÉS, implique protocoles totalement différents)
- Message: "Non-conformité totale: statut amiante opposé au référentiel (signalée vs non signalée), protocoles de sécurité incompatibles"

EXEMPLE 4 - Score 100%:
- Référence: "Sans objet (pas de réseaux ECS)"
- Utilisateur: "N/A - aucun réseau ECS présent"
- Score: 100% (équivalence stricte, même fait)
- Message: "Conforme"

EXEMPLE 5 - Score 100%:
- Référence: "Maintien accès usagers TEC et riverains durant travaux"
- Utilisateur: "Assurer la continuité d'accès pour les usagers TEC et les riverains pendant les travaux"
- Score: 100% (reformulation parfaite, même exigence)
- Message: "Conforme"

CONSIGNES CRITIQUES:
1. LIS CHAQUE VALEUR ATTENDUE **MOT PAR MOT**
2. LIS CHAQUE VALEUR UTILISATEUR **MOT PAR MOT**
3. COMPARE LES **FAITS**, pas les mots
4. Si tu hésites entre 0% et 100%, choisis 0% (principe de sécurité maximale)
5. Tout changement de fait, statut, exigence, portée = 0% AUTOMATIQUEMENT
6. N'utilise JAMAIS de scores intermédiaires (50%, 70%) sauf si vraiment justifié

IMPORTANT - CAS PIÈGES FRÉQUENTS:
- "Obligatoire" vs "Recommandé" = 0% (changement de statut)
- "Non signalée" vs "Présence confirmée" = 0% (faits opposés)
- "En tout temps" vs "Pendant phases critiques" = 0% (changement de portée)
- "Séparé" vs "Centralisé" = 0% (changement de procédure)
- Élément manquant dans liste de sécurité = 0% (incomplet)

RÉPONSE ATTENDUE (JSON strict, aucun texte avant ou après):
{
  "items": [
    {
      "section": "1.5 Amiante",
      "score": 0,
      "message": "Non-conformité totale: statut amiante opposé (signalée vs non signalée)",
      "userSection": "Amiante",
      "userValue": "Présence confirmée selon rapport externe"
    },
    ...
  ]
}

Analyse TOUS les ${referenceEntries.length} items avec RIGUEUR MAXIMALE. En cas de doute, choisis 0%.`;

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  // Extraction du JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Format de réponse Gemini invalide');
  }

  const geminiResult = JSON.parse(jsonMatch[0]);

  // Transformation au format attendu
  const issues = geminiResult.items.map((item) => ({
    section: item.section,
    score: Math.max(0, Math.min(100, item.score)),
    message: item.message || '',
    expectedSnippet: referenceEntries.find((ref) => ref.section === item.section)?.expected || '',
    receivedSnippet: item.userValue || '',
  }));

  const totalScore = issues.reduce((sum, item) => sum + item.score, 0);
  const avgScore = issues.length > 0 ? totalScore / issues.length : 0;

  issues.sort((a, b) => a.score - b.score);

  return {
    score: Number(avgScore.toFixed(1)),
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
