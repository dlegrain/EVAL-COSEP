import { GoogleGenerativeAI } from '@google/generative-ai';
import { getStore } from '@netlify/blobs';
import { google } from 'googleapis';

const parseJson = (text) => {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
};

const appendToGoogleSheet = async ({ firstName, lastName, canvasDetected, confidence, evidence, submittedAt }) => {
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

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Module4!A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [
            new Date(submittedAt).toISOString(),
            firstName,
            lastName,
            canvasDetected ? 'OUI' : 'NON',
            Math.round(confidence * 100) + '%',
            evidence,
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
    const body = JSON.parse(event.body || '{}');
    const { firstName, lastName, imageContent, mimeType = 'image/png' } = body;

    if (!imageContent || typeof imageContent !== 'string') {
      return { statusCode: 400, body: 'Aucune image fournie.' };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: 'GEMINI_API_KEY manquante.' };
    }

    // Appel du modèle vision pour détection de l'icône Canvas
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const prompt = `Analyse l'image fournie. Objectif: vérifier si la barre d'entrée de ChatGPT affiche l'outil "Canvas" activable.
Éléments caractéristiques à repérer (tolérance au thème clair/sombre, langues et variantes d'UI):
- libellé bleu « Canvas » situé près d'une petite icône crayon/pinceau scintillant;
- à proximité du bouton "+" à gauche de la zone de saisie et de l'icône micro/bouton d'envoi à droite;
- style: interface ChatGPT/Chat.openai.com avec champ de prompt.

Donne une réponse STRICTEMENT JSON en suivant ce schéma et rien d'autre:
{ "canvasDetected": true|false, "confidence": number (0-1), "evidence": string (<=140 chars) }`;

    const result = await model.generateContent([
      { inlineData: { data: imageContent, mimeType } },
      { text: prompt }
    ]);
    const text = result?.response?.text?.() || '';
    const json = parseJson(text) || {};

    const canvasDetected = Boolean(json.canvasDetected);
    let confidence = Number(json.confidence);
    if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) confidence = canvasDetected ? 0.6 : 0.4;
    const evidence = String(json.evidence || '').slice(0, 140);

    // Archivage (best-effort) pour audit
    let storage = null;
    try {
      const store = getStore('cosep-uploads');
      const safeName = `${String(firstName||'').trim()}-${String(lastName||'').trim()}`.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'participant';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const key = `canvas-proof/${timestamp}-${safeName}.txt`;
      await store.set(key, JSON.stringify({ canvasDetected, confidence, evidence }, null, 2), { metadata: { type: 'json' } });
      storage = { success: true, location: key };
    } catch (e) {
      storage = { success: false, message: 'Archivage non disponible en local.' };
    }

    // Archivage dans Google Sheets
    const sheetResult = await appendToGoogleSheet({
      firstName: firstName || '',
      lastName: lastName || '',
      canvasDetected,
      confidence,
      evidence,
      submittedAt: Date.now(),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ canvasDetected, confidence, evidence, storage, sheet: sheetResult })
    };
  } catch (error) {
    console.error('Erreur detect-canvas-icon:', error);
    return { statusCode: 500, body: `Erreur serveur: ${error.message}` };
  }
};

