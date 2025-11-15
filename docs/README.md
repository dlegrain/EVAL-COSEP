# Documentation EVAL COSEP

Ce dossier rassemble les informations détaillées pour comprendre, maintenir et faire évoluer le prototype.

## 1. Vue d’ensemble technique

| Couche | Description | Sources principales |
| --- | --- | --- |
| Front web | Application Vite + React monopage. Gestion de l’identification, du chrono, des liens vers les documents et de l’upload du fichier Excel de restitution. | `src/App.jsx`, `src/styles.css` |
| Fonction d’analyse | Netlify Function Node qui convertit l’Excel en JSON, rapproche les sections avec le référentiel, calcule un score et génère un feedback détaillé. | `netlify/functions/analyze-upload.js`, `data/reference.json` |
| Données de référence | JSON produit à partir de l’Excel validé (référence métier). | `data/reference.json`, `reference-generator.js` |
| Analyse collaboration IA | Netlify Function évaluant la qualité du dialogue humain–IA à partir du transcript collé (scoring 0–5, conseils, archivage). | `netlify/functions/analyze-collaboration.js` |
| Stockage d’archives | Netlify Blobs (`@netlify/blobs`) pour conserver une copie du fichier Excel remis. | Même fonction serverless |
| Export résultats | Append vers un Google Sheet via Google API (service account). | `netlify/functions/analyze-upload.js` |

Flux principal :
1. L’utilisateur s’identifie (prénom/nom).
2. Le chrono démarre lorsqu’il accède aux documents.
3. Il dépose un fichier Excel (`.xls`/`.xlsx`) contenant sa synthèse.
4. Le front encode le fichier en base64 et l’envoie à la fonction Netlify avec le temps écoulé.
5. La fonction :
   - Parse le classeur utilisateur, récupère chaque ligne pertinente (section + réponse).
   - Compare avec la référence (normalisation, similarité Levenshtein).
   - Calcule un score global et liste les écarts.
   - Stocke le fichier via Netlify Blobs (si activé).
   - Écrit un résumé dans Google Sheets (si variables d’environnement fournies).
6. Le front affiche le score, le temps, les explications et l’état des archivages.

## 2. Front-end

### 2.1 Structure

- `src/App.jsx`
  - Gestion du state (`phase`, `startTime`, `elapsedMs`, `file`, `analysis`).
  - Persistance `localStorage` pour reprendre la session en cas de rafraîchissement.
  - Timer mis à jour toutes les secondes, affichage « hors délai » si >30 minutes.
  - Upload type `<input type="file">` (accept `.xls,.xlsx`) → conversion en base64.
  - Appel à `/.netlify/functions/analyze-upload` via `fetch`.
  - Zone de collage collaboration avec interception `onPaste` : récupération du contenu HTML (ChatGPT/Gemini) et conversion en texte pour conserver toute la conversation.
  - Nettoyage automatique des marqueurs `You said / ChatGPT said` pour séparer clairement les tours dans l’analyse.
  - Restitution des résultats (score%, liste d’issues, info stockage/Google Sheet).

- `src/styles.css`
  - Styles génériques (layout `.page`, cartes `.card`, boutons).
  - `.timer` surligné en rouge lorsqu’on dépasse 30 minutes (condition via logique JS).
  - Classes `.alert.info` pour indiquer qu’un module est verrouillé (formulaire masqué, seul le retour au dashboard reste possible).

### 2.3 Identification & progression

- **Formulaire de login** : email + prénom + nom → POST `/.netlify/functions/get-progress`.
  - Si l’email est nouveau, la fonction crée une ligne dans l’onglet Google Sheets `Progress`.
  - Les colonnes attendues : `email`, `first_name`, `last_name`, puis pour chaque module `moduleX_status`, `moduleX_score`, `moduleX_elapsed_ms`, `moduleX_updated_at`.
- **Verrouillage UI** : le dashboard bloque les cartes dont `moduleX_status === 'completed'`.
- **Formulaires masqués** : lorsque la progression signale `completed`, l’écran “module actif” affiche uniquement un message d’information + bouton “Retour au menu” (aucune possibilité de relancer la tâche).
- **Sauvegarde** : après chaque analyse réussie (`analyze-upload`, `analyze-collaboration`, `evaluate-legal-training`, `detect-canvas-icon`), le front appelle `/.netlify/functions/update-progress` avec `updates: { moduleN: { status, score, elapsedMs, submittedAt } }`. La fonction fusionne uniquement les colonnes fournies sans toucher aux autres modules.
- **Déconnexion** : un bouton “Se déconnecter” ramène l’utilisateur sur l’écran d’identification sans effacer la feuille Google Sheets.

- `public/documents/`
  - Les PDF exposés : `cahier-des-charges.pdf` et `plan.pdf` (à remplacer par la version réelle).

### 2.2 Timer & persistance

Variables stockées dans `localStorage` :
- `eval-cosep:firstName` / `lastName`
- `eval-cosep:startTime` (timestamp en millisecondes)
- `eval-cosep:phase` (`identify`, `mission`, `submitted`)

Cela permet à l’utilisateur de rafraîchir la page sans perdre le chrono ou ses infos.

## 3. Analyse serverless

### 3.1 Lecture de l’Excel

- `xlsx.read(buffer, { type: 'buffer' })`
- Extraction de la première feuille (`SheetNames[0]`).
- Transformation en tableau brut (`sheet_to_json` avec `header: 1`).
- Chaque ligne est interprétée comme :
  - Colonne 1 : nom de la section.
  - Colonne 2 : réponse utilisateur.
  - Colonne 3+ : notes optionnelles (actuellement ignorées pour le scoring, mais conservées dans `userEntries`).

Un ensemble `userEntries` est construit avec une version normalisée de la section (`normalizeText`) pour faciliter le matching.

### 3.2 Référence

- `referenceData` importé depuis `data/reference.json`.
- Chaque entrée est normalisée en `{ section, expected, extras }`.  
  `extras` contient les champs secondaires (ex. niveau de vigilance).

### 3.3 Calcul du score

1. Pour chaque section attendue :
   - Recherche de la meilleure correspondance côté utilisateur (comparaison normalisée + similarité).
   - Seuil de correspondance de la clé : 60 %.
   - Calcul du score de contenu (`similarityScore` sur les textes attendus vs fournis).
   - Ajout d’un message si le contenu est absent/partiel/divergent.
   - Enregistrement des extra-infos attendues pour rappel.
2. Les entrées utilisateur non appariées sont signalées (score 50, message « section non reconnue »).
3. Score global : moyenne arithmétique des scores par section (0–100). Retour arrondi à 0,1.
4. La réponse renvoyée au front contient :
   - `score`
   - `elapsed` (temps en ms + format mm:ss)
   - `details` (liste qui peut être affichée directement)
   - `storage` (résultat Netlify Blobs)
   - `sheet` (résultat Google Sheets)

### 3.4 Normalisation & similarité

- `normalizeText` : suppression des accents (`NFD`), passage en minuscules, retrait de la ponctuation, compression des espaces.
- `similarityScore` :
  - Cas particuliers (données vides).
  - Levenshtein distance sur les chaînes normalisées.
  - `ratio = 1 - distance / max(lenA,lenB)` → score 0–100.

Les seuils/messageries sont dans `buildComparison`.

### 3.5 Archivage et Google Sheet

- **Netlify Blobs** (`storeUploadedFile`) : enregistrement dans `cosep-uploads/reports/<timestamp>-<filename>`.  
  En cas d’indisponibilité, la fonction renvoie un message sans rompre l’analyse.
- **Google Sheets** (`appendToGoogleSheet`) : écriture en append `A:F`.  
  Format de la ligne : `[ISO datetime, firstName, lastName, "Xm Ys", score, summary]`.
  - `summary` compile les trois premiers écarts (`section: message`).
  - En cas d’erreur d’authentification, l’information remonte côté front.

### 3.6 Analyse collaboration humain–IA

- `netlify/functions/analyze-collaboration.js`
  - Reçoit le transcript complet (texte brut) collé par l’utilisateur.
  - Analyse heuristique : segmentation en tours (prise en charge de marqueurs “You said / ChatGPT said”), comptage de mots/questions, détection de mots-clés (objectifs, conseils, exécution), rapprochement des suggestions IA vs réponses utilisateur.
  - Calcule six scores normalisés 0–5 (intention, dialogue, conseils, réaction, richesse, délégation) + score global, avec exemples concrets extraits et nettoyés du transcript.
  - Produit un diagnostic (commentaires + exemples + listes points forts / axes d’amélioration / conseils personnalisés).
  - Archive la conversation dans Netlify Blobs (`cosep-uploads/collaboration/...`).
  - Enregistre un résumé dans Google Sheets (type de ligne `collaboration`, score converti /100, synthèse critique).

- Le front consomme la réponse pour afficher un tableau des scores, les listes de recommandations et autorise le téléchargement d’un PDF consolidé.

## 4. Utilitaires

- `reference-generator.js` :
  - Script CLI (Node ES modules) pour générer le fichier de référence.
  - Supporte `--sheet=<nom>` et `--out=<fichier>`.
  - Gère les doublons (transforme en tableau).

## 5. Exécution locale

### 5.1 Tests front seul

```bash
npm run dev -- --host 127.0.0.1 --port 5174
```

### 5.2 Tests complets

```bash
npm install -g netlify-cli
netlify dev
```

- Charger la page indiquée (ex. `http://localhost:8888`).
- Soumettre un fichier Excel pour vérifier le scoring.

### 5.3 Build statique

```bash
npm run build
npx serve dist    # ou npx http-server dist
```

La build statique est utile pour vérifier le rendu final ou pour un déploiement manuel.

## 6. Configuration & déploiement

1. Créer un site Netlify, connecter le dépôt.
2. Définir les variables d’environnement (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_SHEETS_ID`).
3. Activer éventuellement Netlify Blobs (plan compatible).
4. Lancer un déploiement (`git push` ou `netlify deploy`).
5. Tester sur l’URL fournie en déposant un Excel de test.

## 7. Personnalisation / évolutions

- **Formulaire d’upload** : si besoin de contraindre le format, adapter `parseUserWorkbook`.
- **Seuils de similarité** : paramètres actuellement dans `buildComparison` (`bestScore < 60`, `fieldScore < 70`, etc.).
- **Rendu front** : ajouter des modales, un histogramme de résultats, etc. via `analysis.details`.
- **IA / scoring avancé** : possibilité d’intégrer une API (Gemini, Vertex, etc.) dans la fonction serverless pour analyser des paragraphes libres.
- **Phase 2** : prévoir un second formulaire ou une deuxième fonction Netlify ; la structure permet d’ajouter d’autres endpoints (`netlify/functions/<nom>.js`).

## 8. Ressources utiles

- [Documentation Vite](https://vitejs.dev/)
- [React](https://react.dev/)
- [Netlify Functions](https://docs.netlify.com/functions/overview/)
- [Netlify Blobs](https://docs.netlify.com/blobs/overview/)
- [Google Sheets API](https://developers.google.com/sheets/api)
- [xlsx](https://github.com/SheetJS/sheetjs)

Cette documentation peut être enrichie à mesure que de nouvelles phases ou règles d’analyse sont ajoutées.
