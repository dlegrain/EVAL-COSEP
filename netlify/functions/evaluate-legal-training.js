import { GoogleGenerativeAI } from '@google/generative-ai';
import legalData from '../../data/legal-training.json' assert { type: 'json' };

const clamp = (n) => {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
};

const buildPrompt = ({ answers }) => {
  const q1 = answers.Q1 || '';
  const q2 = answers.Q2 || '';
  const q3 = answers.Q3 || '';

  const prompt = `Tu évalues 3 réponses libres d'un candidat sur la formation de base en sécurité (chantiers temporaires ou mobiles). Tu évalues le SENS (synonymes acceptés), pas les mots exacts. Réponds en JSON STRICT uniquement.

RÉFÉRENCE (attendus essentiels):
Q1 — Objectif et champ d'application (AR 7 avril 2023)
- Sensibiliser aux risques sur chantiers T/M
- Risques liés à sa propre activité ET aux autres entrepreneurs présents
- L'entrepreneur doit pouvoir DÉMONTRER que la formation suivie répond aux objectifs

Q2 — Contenu et durée minimales (CP 124)
- Durée minimale: 8 heures
- Objectifs (au moins deux valides suffisent pour être considéré partiellement conforme): acteurs; collaboration; principes généraux de prévention; mesures de prévention; comportement sûr et sain.

Q3 — Équivalences / dispenses (CCT + AR)
- Conditions valides (au moins deux pour 100%): VCA valide; expérience 5 ans (10 ans AR / 15 ans CCT); autre formation équivalente; attestation Constructiv conforme; formation sécurité 'construction' validée Constructiv.

RÉPONSES UTILISATEUR:
Q1: ${q1}
Q2: ${q2}
Q3: ${q3}

BARÈME SYNTHÉTIQUE:
- Q1: 100% si les 3 idées; 80% si sensibilisation + multi-entreprises sans démontrabilité; 50% si seulement sensibilisation; 0% sinon.
- Q2: +50% si durée=8h; +25% par objectif valide (jusqu'à 50% pour deux objectifs); clamp 100%.
- Q3: 100% si deux conditions valides ou plus; 50% si une; 0% si aucune.

CONSIGNES DE SORTIE STRICTES:
- RENDS EXACTEMENT 3 objets dans "items", ordre: Q1, Q2, Q3.
- Champs par objet: questionId (Q1/Q2/Q3), score (0..100), comment (<=140 caractères).
- PAS D'AUTRE CHAMP, PAS DE TEXTE HORS JSON.

RÉPONSE (JSON strict uniquement):
{
  "items": [
    { "questionId": "Q1", "score": 100, "comment": "Conforme" },
    { "questionId": "Q2", "score": 75, "comment": "Durée 8h + 1 objectif" },
    { "questionId": "Q3", "score": 50, "comment": "Une condition valide trouvée" }
  ],
  "overall": 75
}`;

  return prompt;
};

const parseJson = (text) => {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
};

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Méthode non autorisée.' };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const { answers, startedAt, submittedAt, elapsedMs } = payload;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: 'GEMINI_API_KEY manquante.' };
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Détection côté serveur des réponses manquantes
    const isEmpty = (s) => !s || !String(s).trim();
    const emptyMap = { Q1: isEmpty(answers?.Q1), Q2: isEmpty(answers?.Q2), Q3: isEmpty(answers?.Q3) };

    const prompt = buildPrompt({ answers: answers || {} });
    const result = await model.generateContent(prompt);
    const text = result?.response?.text?.() || '';
    const json = parseJson(text) || { items: [] };

    // Normalisation stricte et fallback
    const order = ['Q1', 'Q2', 'Q3'];
    const byId = new Map();
    if (Array.isArray(json.items)) {
      for (const it of json.items) {
        if (it && (it.questionId === 'Q1' || it.questionId === 'Q2' || it.questionId === 'Q3')) {
          byId.set(it.questionId, it);
        }
      }
    }

    const details = [];
    for (const qid of order) {
      const base = byId.get(qid) || { questionId: qid, score: 0, comment: 'Non analysé' };
      const forcedAbsent = emptyMap[qid];
      const score = forcedAbsent ? 0 : clamp(base.score);
      const comment = forcedAbsent ? 'Information absente' : String(base.comment || '').slice(0, 140);

      // Construit expectedSnippet pour transparence
      let expectedSnippet = '';
      if (qid === 'Q1') expectedSnippet = legalData.Q1.expected.bullets.join(' ; ');
      if (qid === 'Q2') expectedSnippet = `Durée: ${legalData.Q2.expected.duration}h ; Objectifs (exemples): ${legalData.Q2.expected.objectives.slice(0, 3).join(' ; ')}`;
      if (qid === 'Q3') expectedSnippet = legalData.Q3.expected.conditions.slice(0, 3).join(' ; ');

      details.push({
        questionId: qid,
        score,
        comment,
        expectedSnippet,
        receivedSnippet: String(answers?.[qid] || '')
      });
    }

    const overall = details.length ? details.reduce((s, d) => s + d.score, 0) / details.length : 0;

    return {
      statusCode: 200,
      body: JSON.stringify({
        score: Number(overall.toFixed(1)),
        elapsed: {
          ms: elapsedMs,
          startedAt,
          submittedAt
        },
        details
      })
    };
  } catch (error) {
    console.error('Erreur evaluate-legal-training:', error);
    return { statusCode: 500, body: `Erreur serveur: ${error.message}` };
  }
};

