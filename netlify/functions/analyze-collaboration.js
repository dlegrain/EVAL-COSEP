import { getStore } from '@netlify/blobs';
import { google } from 'googleapis';

const clamp = (value, min = 0, max = 5) => Math.max(min, Math.min(max, value));

const keywordCount = (text, keywords) =>
  keywords.reduce((total, keyword) => {
    const matches = text.match(new RegExp(keyword, 'gi'));
    return total + (matches ? matches.length : 0);
  }, 0);

const computeMetrics = (transcript) => {
  const cleaned = transcript.trim();
  const blocks = cleaned.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const lines = cleaned.split('\n').filter((line) => line.trim().length > 0);
  const words = cleaned.split(/\s+/).filter(Boolean);
  const uniqueWords = new Set(words.map((w) => w.toLowerCase().replace(/[^a-zàâçéèêëîïôûùüÿñæœ0-9]/gi, ''))).size;
  const questions = (cleaned.match(/\?/g) || []).length;

  const userTurns = blocks.filter(
    (block) =>
      /^user\b/i.test(block) ||
      /^utilisateur\b/i.test(block) ||
      block.toLowerCase().startsWith('moi :') ||
      block.toLowerCase().startsWith('moi:')
  ).length;

  const assistantTurns = blocks.filter(
    (block) =>
      /^assistant\b/i.test(block) ||
      /^ia\b/i.test(block) ||
      block.toLowerCase().startsWith('ia :') ||
      block.toLowerCase().startsWith('ia:')
  ).length;

  return {
    cleaned,
    blocks,
    lines,
    totalWords: words.length,
    uniqueWords,
    questions,
    userTurns,
    assistantTurns,
    totalTurns: blocks.length,
    avgWordsPerBlock: blocks.length ? Math.round(words.length / blocks.length) : 0,
    firstBlock: blocks[0] || '',
    lastBlock: blocks[blocks.length - 1] || '',
  };
};

const evaluateTranscript = (transcript) => {
  const metrics = computeMetrics(transcript);
  const { cleaned, firstBlock, totalTurns, questions, totalWords, uniqueWords, avgWordsPerBlock } = metrics;

  const clarityKeywords = ['objectif', 'but', 'livrable', 'cible', 'contexte', 'contexte', 'mission', 'attendu', 'finalité'];
  let clarityScore = 1;
  if (firstBlock.length > 80) clarityScore += 1.2;
  if (keywordCount(firstBlock, clarityKeywords) >= 2) clarityScore += 2;
  if (questions > 3) clarityScore += 0.5;
  clarityScore = clamp(clarityScore);
  const clarityComment =
    clarityScore >= 4.5
      ? 'Objectif très bien posé et contextualisé.'
      : clarityScore >= 3.5
      ? 'Objectif global compris mais peut gagner en précision.'
      : 'Objectif flou ou mal cadré ; expliciter la finalité et les contraintes.';

  let dialogueScore = clamp((totalTurns - 4) / 2.5);
  if (dialogueScore < 1 && totalTurns >= 6) dialogueScore = 1;
  const dialogueComment =
    dialogueScore >= 4
      ? 'Dialogue approfondi avec rebonds fréquents.'
      : dialogueScore >= 3
      ? 'Échanges présents mais gagneraient à être plus soutenus.'
      : 'Interaction trop courte ou monologique ; multiplier les rebonds.';

  const adviceCount = keywordCount(cleaned, ['conseil', 'conseille', 'alternati', 'option', 'idée', 'recommand', 'stratégie']);
  const depthQuestions = keywordCount(cleaned, ['pourquoi', 'comment', 'quelle approche', 'quelles options', 'risque']);
  let adviceScore = clamp(adviceCount * 0.8 + depthQuestions * 0.6);
  if (questions > 6) adviceScore = clamp(adviceScore + 1);
  const adviceComment =
    adviceScore >= 4
      ? 'Très bonne recherche de points de vue et d’angles.'
      : adviceScore >= 3
      ? 'Quelques sollicitations d’angles ; pousser davantage la curiosité stratégique.'
      : 'Peu de demandes de conseils ou d’alternatives ; solliciter l’IA sur ses idées.';

  const reactionKeywords = ['merci', 'je vais', 'je vais tester', 'd’accord', 'je reprends', 'comme proposé', 'j’applique', 'je retiens'];
  const reactionCount = keywordCount(cleaned, reactionKeywords);
  let reactionScore = clamp(reactionCount * 1.2);
  if (reactionScore < 2 && totalTurns > 10) reactionScore += 1;
  const reactionComment =
    reactionScore >= 4
      ? 'Intégration active des suggestions de l’IA.'
      : reactionScore >= 3
      ? 'Quelques rebonds sur les propositions ; peut aller plus loin.'
      : "Peu d'exploitation des suggestions ; valider ou tester explicitement les pistes.";

  const richnessBase = clamp((uniqueWords / Math.max(totalWords, 1)) * 15 + avgWordsPerBlock / 40);
  const longPromptBonus = firstBlock.length > 180 ? 0.5 : 0;
  const richnessScore = clamp(richnessBase + longPromptBonus);
  const richnessComment =
    richnessScore >= 4
      ? 'Prompts riches, contextualisés et nuancés.'
      : richnessScore >= 3
      ? 'Bonne base ; ajouter davantage de contexte ou de contraintes.'
      : 'Prompts trop courts ou génériques ; détailler le contexte et les attentes.';

  const delegationKeywords = ['analyse', 'évalue', 'structure', 'diagnostic', 'modélise', 'raisonne', 'compare', 'critique'];
  const executionKeywords = ['résume', 'résumer', 'résumé', 'liste', 'trier', 'copie', 'transcrire'];
  const delegationScore = clamp(keywordCount(cleaned, delegationKeywords) * 0.9 + (questions > 4 ? 1 : 0) - executionKeywords.length * 0.1);
  const delegationComment =
    delegationScore >= 4
      ? 'L’IA est sollicitée comme coéquipier cognitif.'
      : delegationScore >= 3
      ? 'Usage hybride ; continuer à pousser l’IA sur des tâches de raisonnement.'
      : 'Usage principalement exécutif ; confier des analyses plus complexes à l’IA.';

  const categories = {
    clarity: {
      label: "Clarté de l’intention",
      score: clarityScore,
      comment: clarityComment,
    },
    dialogue: {
      label: 'Qualité du dialogue',
      score: dialogueScore,
      comment: dialogueComment,
    },
    advice: {
      label: 'Conseils & angles',
      score: adviceScore,
      comment: adviceComment,
    },
    reaction: {
      label: 'Réaction aux suggestions',
      score: reactionScore,
      comment: reactionComment,
    },
    richness: {
      label: 'Richesse des requêtes',
      score: richnessScore,
      comment: richnessComment,
    },
    delegation: {
      label: 'Niveau de délégation',
      score: delegationScore,
      comment: delegationComment,
    },
  };

  const overall = clamp(
    (clarityScore + dialogueScore + adviceScore + reactionScore + richnessScore + delegationScore) / 6,
    0,
    5
  );

  const strengths = Object.values(categories)
    .filter((item) => item.score >= 4)
    .map((item) => `${item.label} — ${item.comment}`);

  const improvements = Object.values(categories)
    .filter((item) => item.score < 3.2)
    .map((item) => `${item.label} — ${item.comment}`);

  const tips = [];
  if (clarityScore < 4) tips.push('Commencer vos échanges par une formulation explicite du livrable attendu et des contraintes.');
  if (dialogueScore < 4) tips.push('Favoriser les relances ciblées : “propose-moi un autre angle”, “que se passe-t-il si…”.');
  if (adviceScore < 4) tips.push('Explorer plusieurs alternatives et demander des comparaisons chiffrées ou argumentées.');
  if (reactionScore < 4) tips.push("Valider ou écarter explicitement les pistes données par l'IA et expliquer vos choix.");
  if (richnessScore < 4) tips.push('Préparer vos prompts en listant contexte, contraintes, format attendu avant de solliciter l’IA.');
  if (delegationScore < 4) tips.push('Confier des tâches analytiques à l’IA (diagnostics, matrices de décision) plutôt que de simples résumés.');

  return {
    metrics: {
      totalWords,
      uniqueWords,
      totalTurns,
      avgWordsPerBlock,
      questions,
      extractedKeywords: {
        advice: adviceCount,
        reaction: reactionCount,
      },
    },
    scores: categories,
    overall,
    advice: { strengths, improvements, tips },
  };
};

const storeTranscript = async (firstName, lastName, transcript) => {
  try {
    const store = getStore({ name: 'cosep-uploads' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = `${firstName}-${lastName}`.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    const key = `collaboration/${timestamp}-${safeName}.txt`;
    await store.set(key, transcript, { metadata: { firstName, lastName } });
    return { success: true, location: key };
  } catch (error) {
    console.warn('Stockage transcript indisponible:', error.message);
    return { success: false, message: 'Archivage de la conversation indisponible.' };
  }
};

const appendToGoogleSheet = async ({ firstName, lastName, overall, summary, submittedAt }) => {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, '\n');
  const sheetId = process.env.GOOGLE_SHEETS_ID;

  if (!clientEmail || !privateKey || !sheetId) {
    return {
      success: false,
      message: 'Variables Google Sheets manquantes. Résultat collaboration non archivé.',
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
      range: 'A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [
            new Date(submittedAt).toISOString(),
            firstName,
            lastName,
            'collaboration',
            Number((overall * 20).toFixed(1)), // conversion sur 100
            summary,
          ],
        ],
      },
    });

    return { success: true, message: 'Analyse collaboration archivée dans Google Sheets.' };
  } catch (error) {
    console.error('Erreur Google Sheets (collaboration):', error.message);
    return { success: false, message: `Echec archivage collaboration: ${error.message}` };
  }
};

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Méthode non autorisée.' };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const { firstName, lastName, transcript, extractionScore, submittedAt } = payload;

    if (!firstName || !lastName || !transcript) {
      return { statusCode: 400, body: "Champs requis manquants (prénom, nom, transcript)." };
    }

    const evaluation = evaluateTranscript(transcript);

    const summary = Object.values(evaluation.scores)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map((item) => `${item.label}: ${item.comment}`)
      .join(' | ');

    const storage = await storeTranscript(firstName, lastName, transcript);
    const sheet = await appendToGoogleSheet({
      firstName,
      lastName,
      overall: evaluation.overall,
      summary,
      submittedAt: submittedAt || Date.now(),
    });

    const response = {
      overall: evaluation.overall,
      scores: evaluation.scores,
      advice: evaluation.advice,
      storage,
      sheet,
      metrics: {
        ...evaluation.metrics,
        extractionScore: extractionScore ?? null,
      },
    };

    return { statusCode: 200, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Erreur analyse collaboration:', error);
    return { statusCode: 500, body: `Erreur serveur: ${error.message}` };
  }
};
