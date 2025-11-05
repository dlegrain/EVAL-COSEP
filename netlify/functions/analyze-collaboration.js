import { getStore } from '@netlify/blobs';
import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';

const clamp = (value, min = 0, max = 5) => Math.max(min, Math.min(max, value));

const WORD_REGEX = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;

const extractWords = (text) => {
  const matches = text.match(WORD_REGEX);
  return matches ? matches.map((word) => word.toLowerCase()) : [];
};

const sanitizeSnippet = (text) =>
  text
    .replace(/(chatgpt|assistant|you|user)\s+said\s*:?/gi, '')
    .replace(/stopped\s+(?:reading|searching)\s+\w+/gi, '')
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/\b\S+\.(pdf|docx?|xlsx|pptx?)\b/gi, '')
    .replace(/\b\S+\.(pdf|docx?|xlsx|pptx?)\s*pdf\b/gi, '')
    .replace(/\bpdf\b/gi, '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

const excerpt = (text, max = 160) => {
  if (!text) {
    return '';
  }
  const cleaned = sanitizeSnippet(text);
  if (!cleaned) {
    return '';
  }
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
};

const containsAny = (text, patterns) => patterns.some((pattern) => pattern.test(text));

const ADVICE_PATTERNS = [
  /conseil/i,
  /recommand/i,
  /avis/i,
  /opinion/i,
  /point de vue/i,
  /angle/i,
  /strat[ée]gie/i,
  /alternativ/i,
  /variante/i,
  /risque/i,
  /opportunit/i,
  /feedback/i,
  /discut/i,
  /brainstorm/i,
  /explor/i,
  /peux-tu\s+m'aider/i,
  /aide-moi/i,
  /aide\s+?moi/i,
  /que\s+penses-tu/i,
  /ton\s+avis/i,
  /que\s+(?:me|nous)\s+conseilles-tu/i,
  /que\s+proposerais-tu/i,
  /que\s+proposes-tu/i,
  /quelles?\s+recommandations?/i,
  /quelles?\s+approches?/i,
  /quelles?\s+options?/i,
  /quelles?\s+alternatives?/i,
];

const DEEP_QUESTION_PATTERNS = [
  /pourquoi/i,
  /comment/i,
  /quels?\s+risques?/i,
  /quelles?\s+cons[eé]quences?/i,
  /que\s+devrions?-?nous/i,
  /que\s+ferais-tu/i,
  /quelle\s+d[ée]marche/i,
  /quelle\s+strat[ée]gie/i,
  /quel\s+plan/i,
  /pouvons?-?nous\s+discuter/i,
  /explorons?/i,
  /discuter/i,
];

const EXECUTION_PATTERNS = [
  /résum/i,
  /sommaire/i,
  /donne[-\s]?moi/i,
  /peux-tu\s+(?:me\s+)?(?:donner|fournir|lister|r[ée]diger|produire|g[ée]n[ée]rer|cr[eé]er)/i,
  /pourrais-tu\s+(?:me\s+)?(?:donner|fournir|lister|produire|cr[eé]er)/i,
  /liste(?:-moi)?/i,
  /extrait/i,
  /copie/i,
  /transcri/i,
  /r[eé]dige/i,
  /[ée]cris/i,
  /fais(?:\s+)?un\s+tableau/i,
  /tradui/i,
  /g[ée]n[ée]re/i,
  /peux-tu\s+m'\s?indiquer/i,
];

const USER_PREFIXES = [
  /^(utilisateur|user|moi|humain|human|collaborateur|pilote|chef|client)\s*[:\-]/i,
  /^(you\s+said|vous\s+avez\s+dit|you)\s*[:\-]/i,
  /^\s*U\s*[:\-]/i,
];

const ASSISTANT_PREFIXES = [
  /^(assistant|ia|ai|bot|chatgpt|gpt|gemini|copilot|assistant virtuel)\s*[:\-]/i,
  /^(chatgpt\s+said|l['’]ia\s+a\s+répondu)\s*[:\-]/i,
  /^\s*A\s*[:\-]/i,
];

const detectSpeaker = (line) => {
  const sanitized = line.replace(/[“”]/g, '"');
  for (const regex of USER_PREFIXES) {
    if (regex.test(sanitized)) {
      return { speaker: 'user', cleaned: sanitized.replace(regex, '').trim() };
    }
  }
  for (const regex of ASSISTANT_PREFIXES) {
    if (regex.test(sanitized)) {
      return { speaker: 'assistant', cleaned: sanitized.replace(regex, '').trim() };
    }
  }
  return null;
};

const parseTranscript = (transcript) => {
  const normalized = transcript.replace(/\r\n/g, '\n');
  const markerRegex = /(You\s+said\s*:|You\s*:|Vous\s+avez\s+dit\s*:|Tu\s+as\s+dit\s*:|Utilisateur\s*:|User\s*:|Moi\s*:|ChatGPT\s+said\s*:|ChatGPT\s*:|Assistant\s+said\s*:|Assistant\s*:|IA\s*:|AI\s*:|Bot\s*:)/gi;
  const segmented = normalized.replace(markerRegex, '\n$1');
  const collapsed = segmented.replace(/\n{2,}/g, '\n').trim();
  const lines = collapsed.split('\n');
  const turns = [];
  let current = null;

  lines.forEach((rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      return;
    }

    const detection = detectSpeaker(trimmed);
    let speaker;
    let content = trimmed;

    if (detection) {
      ({ speaker } = detection);
      content = detection.cleaned;
    } else if (/^[-•*]/.test(trimmed) && current) {
      speaker = current.speaker;
      content = trimmed.replace(/^[-•*]\s*/, '');
    } else if (!current) {
      speaker = 'user';
    } else {
      speaker = current.speaker;
    }

    if (!content) {
      return;
    }

    if (!current || current.speaker !== speaker) {
      if (current) {
        current.text = current.text.join(' ');
        current.words = extractWords(current.text);
        current.wordCount = current.words.length;
        current.sentences = current.text.split(/[.!?]+/).filter((sentence) => sentence.trim().length > 0);
        current.questionMarks = (current.text.match(/\?/g) || []).length;
        turns.push(current);
      }
      current = {
        speaker,
        text: [content],
        rawLines: [rawLine],
      };
    } else {
      current.text.push(content);
      current.rawLines.push(rawLine);
    }
  });

  if (current) {
    current.text = current.text.join(' ');
    current.words = extractWords(current.text);
    current.wordCount = current.words.length;
    current.sentences = current.text.split(/[.!?]+/).filter((sentence) => sentence.trim().length > 0);
    current.questionMarks = (current.text.match(/\?/g) || []).length;
    turns.push(current);
  }

  turns.forEach((turn, index) => {
    turn.index = index;
  });

  const userTurns = turns.filter((turn) => turn.speaker === 'user');
  const assistantTurns = turns.filter((turn) => turn.speaker === 'assistant');
  const totalUserWords = userTurns.reduce((sum, turn) => sum + turn.wordCount, 0);
  const uniqueUserWords = new Set(userTurns.flatMap((turn) => turn.words)).size;
  const totalQuestions = userTurns.reduce((sum, turn) => sum + turn.questionMarks, 0);

  return {
    turns,
    userTurns,
    assistantTurns,
    totalTurns: turns.length,
    totalUserWords,
    uniqueUserWords,
    totalQuestions,
  };
};

const evaluateWithGemini = async (transcript, metrics) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY non configurée');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `Tu es un expert en collaboration humain–IA. Tu dois analyser EN DÉTAIL et EXHAUSTIVEMENT cette conversation entre un utilisateur et une IA.

IMPORTANT : Lis TOUT le transcript du début à la fin. Ton analyse doit être RICHE et APPROFONDIE, pas superficielle. Ne te contente pas de survoler, examine chaque interaction.

TRANSCRIPT:
${transcript}

MÉTRIQUES DE BASE (informatives):
- Tours totaux: ${metrics.totalTurns}
- Tours utilisateur: ${metrics.userTurns}
- Mots utilisateur: ${metrics.totalUserWords}
- Questions: ${metrics.totalQuestions}

CRITÈRES D'ÉVALUATION (0-5):

1. **Clarté de l'intention** (clarity):
   - 0-1: Aucun contexte, demande floue tout au long de la conversation
   - 2-3: Contexte partiel, objectif vague ou explicité tardivement
   - 4-5: Objectif clair, contraintes explicites, contexte complet (rôle utilisateur, rôle IA, but poursuivi)
   Analyse TOUT le transcript : L'utilisateur a-t-il clairement expliqué son rôle, le rôle attendu de l'IA, le contexte du projet, et le but final recherché ? Regarde au-delà du premier prompt.

2. **Qualité du dialogue** (dialogue):
   - 0-1: Monologue, pas d'itération
   - 2-3: Quelques échanges, peu de rebonds
   - 4-5: Dialogue riche, relances pertinentes, construction progressive
   Analyse: L'utilisateur rebondit-il sur les réponses de l'IA ? Y a-t-il une vraie conversation ?

3. **Conseils & angles** (advice):
   - 0-1: Aucune demande de conseil, approche unique
   - 2-3: Quelques questions ouvertes
   - 4-5: Exploration active d'alternatives, demande d'avis critique, comparaisons
   Analyse: L'utilisateur sollicite-t-il des perspectives variées et des conseils stratégiques ?

4. **Réaction aux suggestions** (reaction):
   - 0-1: Ignore les propositions de l'IA
   - 2-3: Accuse réception sans exploiter
   - 4-5: Intègre, discute, développe, questionne les idées proposées
   Analyse: L'utilisateur exploite-t-il réellement les suggestions de l'IA ? Les intègre-t-il dans la suite ?

5. **Richesse des requêtes** (richness):
   - 0-1: Prompts très courts, télégraphiques, sans contexte
   - 2-3: Prompts basiques mais complets
   - 4-5: Prompts détaillés, contextualisés, nuancés, structurés
   Analyse: Les prompts sont-ils construits, informatifs et bien rédigés ?

6. **Niveau de délégation** (delegation):
   - 0-1: Demandes purement exécutives (résume, liste, copie, transcris)
   - 2-3: Mix exécution/réflexion
   - 4-5: Tâches cognitives dominantes (analyse, évalue, compare, structure, diagnostique, priorise)
   Analyse: L'utilisateur délègue-t-il des tâches analytiques et stratégiques ou juste de l'exécution mécanique ?

CONSIGNES STRICTES:
- LIS ABSOLUMENT TOUT LE TRANSCRIPT EN DÉTAIL, du premier au dernier mot
- Base-toi sur le contenu réel et les comportements observés, pas uniquement sur les métriques quantitatives
- Identifie des exemples concrets (extraits courts) qui justifient tes scores
- Sois CRITIQUE et FACTUEL, pas encourageant artificiellement
- COHÉRENCE : deux utilisateurs avec des comportements similaires doivent avoir des scores proches
- Ne survole pas : l'analyse doit refléter une lecture complète et attentive

RÉPONSE ATTENDUE (JSON strict, aucun texte avant ou après):
{
  "scores": {
    "clarity": { "score": 3.5, "comment": "Bref commentaire factuel", "example": "Extrait pertinent court" },
    "dialogue": { "score": 4.2, "comment": "...", "example": "..." },
    "advice": { "score": 2.1, "comment": "...", "example": "..." },
    "reaction": { "score": 3.8, "comment": "...", "example": "..." },
    "richness": { "score": 2.9, "comment": "...", "example": "..." },
    "delegation": { "score": 4.0, "comment": "...", "example": "..." }
  },
  "strengths": ["Point fort concret 1", "Point fort concret 2"],
  "improvements": ["Axe amélioration précis 1", "Axe amélioration précis 2"],
  "tips": ["Conseil actionnable 1", "Conseil actionnable 2", "Conseil actionnable 3"]
}`;

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  // Extraction du JSON (au cas où Gemini ajoute du texte autour)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Format de réponse Gemini invalide');
  }

  const geminiResult = JSON.parse(jsonMatch[0]);

  // Transformation au format attendu par le front
  const categories = {
    clarity: {
      label: "Clarté de l'intention",
      score: clamp(geminiResult.scores.clarity.score),
      comment: geminiResult.scores.clarity.comment,
      example: geminiResult.scores.clarity.example,
    },
    dialogue: {
      label: 'Qualité du dialogue',
      score: clamp(geminiResult.scores.dialogue.score),
      comment: geminiResult.scores.dialogue.comment,
      example: geminiResult.scores.dialogue.example,
    },
    advice: {
      label: 'Conseils & angles',
      score: clamp(geminiResult.scores.advice.score),
      comment: geminiResult.scores.advice.comment,
      example: geminiResult.scores.advice.example,
    },
    reaction: {
      label: 'Réaction aux suggestions',
      score: clamp(geminiResult.scores.reaction.score),
      comment: geminiResult.scores.reaction.comment,
      example: geminiResult.scores.reaction.example,
    },
    richness: {
      label: 'Richesse des requêtes',
      score: clamp(geminiResult.scores.richness.score),
      comment: geminiResult.scores.richness.comment,
      example: geminiResult.scores.richness.example,
    },
    delegation: {
      label: 'Niveau de délégation',
      score: clamp(geminiResult.scores.delegation.score),
      comment: geminiResult.scores.delegation.comment,
      example: geminiResult.scores.delegation.example,
    },
  };

  const overall = clamp(
    (categories.clarity.score +
      categories.dialogue.score +
      categories.advice.score +
      categories.reaction.score +
      categories.richness.score +
      categories.delegation.score) /
      6,
    0,
    5
  );

  return {
    metrics,
    scores: categories,
    overall,
    advice: {
      strengths: geminiResult.strengths || [],
      improvements: geminiResult.improvements || [],
      tips: geminiResult.tips || [],
    },
  };
};

const evaluateTranscriptHeuristic = (transcript) => {
  const parsed = parseTranscript(transcript);
  const { turns, userTurns, assistantTurns, totalTurns, totalUserWords, uniqueUserWords, totalQuestions } = parsed;

  const firstUser = userTurns[0];
  const firstUserText = firstUser?.text || '';
  const firstUserWordCount = firstUser?.wordCount || 0;
  const firstUserLower = firstUserText.toLowerCase();

  const clarityKeywords = ['objectif', 'but', 'livrable', 'contexte', 'perimetre', 'périmètre', 'contrainte', 'délai', 'audience', 'livraison'];
  const clarityKeywordMatches = clarityKeywords.filter((keyword) => firstUserLower.includes(keyword)).length;
  let clarityScore = 0.5;
  if (firstUserWordCount >= 60) clarityScore += 3.2;
  else if (firstUserWordCount >= 35) clarityScore += 2.3;
  else if (firstUserWordCount >= 20) clarityScore += 1.3;
  if (clarityKeywordMatches >= 3) clarityScore += 1.2;
  else if (clarityKeywordMatches >= 1) clarityScore += 0.6;
  if (firstUser?.questionMarks) clarityScore += 0.3;
  clarityScore = clamp(clarityScore);
  const clarityComment = firstUser
    ? `Brief initial de ${firstUserWordCount} mots (${clarityKeywordMatches} mot-clé${clarityKeywordMatches > 1 ? 's' : ''}).`
    : 'Pas de brief initial explicite détecté.';
  const clarityExample = firstUser ? excerpt(firstUser.text, 220) : '';

  const dialogueScore = clamp((totalTurns - 4) / 2.5 + Math.min(userTurns.length, assistantTurns.length) * 0.15);
  const dialogueComment = `Tours totaux : ${totalTurns} (utilisateur ${userTurns.length} / IA ${assistantTurns.length}).`;
  const dialogueExample = (() => {
    for (let i = 0; i < turns.length - 2; i += 1) {
      if (turns[i].speaker === 'user' && turns[i + 1].speaker === 'assistant') {
        const nextUser = turns.slice(i + 2).find((turn) => turn.speaker === 'user');
        if (nextUser) {
          return `Tour ${i + 1}: « ${excerpt(turns[i].text, 80)} » → IA : « ${excerpt(turns[i + 1].text, 80)} » → relance : « ${excerpt(nextUser.text, 70)} ». `;
        }
      }
    }
    return 'Peu de rebonds identifiés après les réponses de l\'IA.';
  })();

  const advicePrompts = userTurns.filter((turn) => {
    const lower = turn.text.toLowerCase();
    if (containsAny(lower, EXECUTION_PATTERNS)) {
      return false;
    }
    if (containsAny(lower, ADVICE_PATTERNS)) {
      return true;
    }
    if (turn.questionMarks > 0 && containsAny(lower, DEEP_QUESTION_PATTERNS)) {
      return true;
    }
    return false;
  });
  const adviceScore = clamp(advicePrompts.length * 0.9 + Math.min(totalQuestions, 6) * 0.2);
  const adviceComment = `${advicePrompts.length} sollicitation${advicePrompts.length > 1 ? 's' : ''} de conseils / angles.`;
  const adviceExample = advicePrompts.length
    ? `Exemple : « ${excerpt(advicePrompts[0].text, 160)} »`
    : 'Aucune demande explicite de conseils ou d\'alternatives.';

  const acknowledgementRegex = /(merci|parfait|je\s+vais|je\s+vais\s+tester|je\s+vais\s+appliquer|je\s+reprends|je\s+ret[iy]ens|je\s+choisis|allons-y|d'accord|ça marche|je valide|ok|bien\s+compris|entendu)/i;
  const reactionPairs = assistantTurns
    .map((assistantTurn) => {
      const nextUser = turns.slice(assistantTurn.index + 1).find((turn) => turn.speaker === 'user');
      if (!nextUser) {
        return null;
      }
      const acknowledgement = acknowledgementRegex.test(nextUser.text);
      const overlap = assistantTurn.words.filter((word) => word.length > 6 && nextUser.words.includes(word)).length;
      const develops = nextUser.wordCount > 12 && nextUser.wordCount >= Math.min(assistantTurn.wordCount * 0.4, 18);
      const positive = acknowledgement || overlap >= 2 || develops;
      const minimal = !positive && nextUser.wordCount <= 6 && assistantTurn.wordCount > 25;
      const weight = (acknowledgement ? 2 : 0) + overlap + (develops ? 3 : 0);
      return {
        assistant: assistantTurn,
        user: nextUser,
        acknowledgement,
        overlap,
        develops,
        positive,
        minimal,
        weight,
      };
    })
    .filter(Boolean);

  const reactionPositive = reactionPairs.filter((pair) => pair.positive).sort((a, b) => b.weight - a.weight);
  const reactionMinimal = reactionPairs.filter((pair) => pair.minimal);

  const reactionScore = clamp(1 + reactionPositive.length * 1.2 - reactionMinimal.length * 0.9);
  const reactionComment = `${reactionPositive.length} intégration${reactionPositive.length > 1 ? 's' : ''}, ${reactionMinimal.length} réponse${reactionMinimal.length > 1 ? 's' : ''} minimales.`;
  const reactionExample = reactionPositive.length
    ? `Suivi : « ${excerpt(reactionPositive[0].assistant.text, 70)} » → « ${excerpt(reactionPositive[0].user.text, 70)} ». `
    : reactionMinimal.length
    ? `Suggestion peu exploitée : « ${excerpt(reactionMinimal[0].assistant.text, 70)} » → « ${excerpt(reactionMinimal[0].user.text, 60)} ». `
    : 'Peu de traces de validation ou d\'application des idées proposées.';

  const avgWordsPerPrompt = userTurns.length ? totalUserWords / userTurns.length : 0;
  const lexicalVariety = totalUserWords ? uniqueUserWords / totalUserWords : 0;
  let richnessScore = clamp((avgWordsPerPrompt / 25) * 3 + lexicalVariety * 2);
  if (avgWordsPerPrompt < 8) {
    richnessScore = Math.min(richnessScore, 1.8 + avgWordsPerPrompt * 0.3);
  }
  const richnessComment = `Prompts moyens : ${avgWordsPerPrompt.toFixed(1)} mots, variété ${Math.round(lexicalVariety * 100)} %.`;
  const longestPrompt = userTurns.reduce((prev, curr) => (curr.wordCount > (prev?.wordCount || 0) ? curr : prev), null);
  const richnessExample = longestPrompt
    ? `Prompt le plus développé (${longestPrompt.wordCount} mots) : « ${excerpt(longestPrompt.text, 160)} »`
    : 'Aucun prompt utilisateur détecté.';

  const cognitiveVerbs = ['analyse', 'analyser', 'évalue', 'évaluer', 'diagnostique', 'diagnostiquer', 'structure', 'structurer', 'priorise', 'prioriser', 'hiérarchise', 'argumente', 'argumenter', 'quantifie', 'planifie', 'projette', 'compare', 'comparer', 'critique', 'synthétise', 'élabore'];
  const executionVerbs = ['résume', 'résumer', 'résumé', 'liste', 'lister', 'trie', 'trier', 'copie', 'transcrit', 'reformule'];
  const cognitiveHits = userTurns.reduce(
    (count, turn) => count + cognitiveVerbs.filter((verb) => turn.text.toLowerCase().includes(verb)).length,
    0
  );
  const executionHits = userTurns.reduce(
    (count, turn) => count + executionVerbs.filter((verb) => turn.text.toLowerCase().includes(verb)).length,
    0
  );
  const delegationScore = clamp(1 + cognitiveHits * 0.9 + Math.min(totalQuestions, 5) * 0.2 - executionHits * 0.6);
  const delegationComment = `${cognitiveHits} requête${cognitiveHits > 1 ? 's' : ''} cognitives vs ${executionHits} demande${executionHits > 1 ? 's' : ''} d'exécution.`;
  const delegationExample = (() => {
    if (cognitiveHits > 0) {
      const turn = userTurns.find((t) => cognitiveVerbs.some((verb) => t.text.toLowerCase().includes(verb)));
      if (turn) {
        return `Exemple cognitif : « ${excerpt(turn.text, 160)} »`;
      }
    }
    if (executionHits > 0) {
      const turn = userTurns.find((t) => executionVerbs.some((verb) => t.text.toLowerCase().includes(verb)));
      if (turn) {
        return `Demande surtout exécutive : « ${excerpt(turn.text, 160)} »`;
      }
    }
    return 'Aucune instruction marquante détectée.';
  })();

  const categories = {
    clarity: {
      label: "Clarté de l'intention",
      score: clarityScore,
      comment: clarityComment,
      example: clarityExample,
    },
    dialogue: {
      label: 'Qualité du dialogue',
      score: dialogueScore,
      comment: dialogueComment,
      example: dialogueExample,
    },
    advice: {
      label: 'Conseils & angles',
      score: adviceScore,
      comment: adviceComment,
      example: adviceExample,
    },
    reaction: {
      label: 'Réaction aux suggestions',
      score: reactionScore,
      comment: reactionComment,
      example: reactionExample,
    },
    richness: {
      label: 'Richesse des requêtes',
      score: richnessScore,
      comment: richnessComment,
      example: richnessExample,
    },
    delegation: {
      label: 'Niveau de délégation',
      score: delegationScore,
      comment: delegationComment,
      example: delegationExample,
    },
  };

  const overall = clamp(
    (categories.clarity.score +
      categories.dialogue.score +
      categories.advice.score +
      categories.reaction.score +
      categories.richness.score +
      categories.delegation.score) /
      6,
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
  if (categories.clarity.score < 4) tips.push('Commencer vos échanges par une formulation explicite du livrable attendu et des contraintes.');
  if (categories.dialogue.score < 4) tips.push('Multiplier les relances ciblées : "propose un autre angle", "que se passe-t-il si…".');
  if (categories.advice.score < 4) tips.push('Explorer plusieurs alternatives et demander des comparaisons argumentées.');
  if (categories.reaction.score < 4) tips.push("Valider ou écarter explicitement les pistes données par l'IA et expliquer vos choix.");
  if (categories.richness.score < 4) tips.push('Préparer vos prompts en listant contexte, contraintes, format attendu avant de solliciter l\'IA.');
  if (categories.delegation.score < 4) tips.push('Confier des tâches analytiques à l\'IA (diagnostics, matrices de décision) plutôt que de simples résumés.');

  return {
    metrics: {
      totalTurns,
      totalUserWords,
      uniqueUserWords,
      totalQuestions,
      avgWordsPerPrompt,
    },
    scores: categories,
    overall,
    advice: { strengths, improvements, tips },
  };
};

const evaluateTranscript = async (transcript) => {
  const parsed = parseTranscript(transcript);
  const { totalTurns, totalUserWords, uniqueUserWords, totalQuestions } = parsed;
  const { userTurns } = parsed;

  const metrics = {
    totalTurns,
    userTurns: userTurns.length,
    totalUserWords,
    uniqueUserWords,
    totalQuestions,
    avgWordsPerPrompt: userTurns.length ? totalUserWords / userTurns.length : 0,
  };

  try {
    // Tenter l'analyse avec Gemini
    return await evaluateWithGemini(transcript, metrics);
  } catch (error) {
    console.warn('Analyse Gemini échouée, fallback sur analyse heuristique:', error.message);
    // Fallback sur analyse heuristique
    return evaluateTranscriptHeuristic(transcript);
  }
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

    const evaluation = await evaluateTranscript(transcript);

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
