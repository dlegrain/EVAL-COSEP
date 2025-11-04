# EVAL COSEP – prototype d’évaluation automatisée

Plateforme d’évaluation destinée à mesurer la capacité d’un utilisateur à extraire et structurer les informations d’un cahier des charges. Elle comprend :

- un front React/Vite servant l’interface d’évaluation (identification, accès aux documents, chrono 30 min, dépôt d’un Excel libre) ;
- une fonction Netlify qui analyse l’Excel fourni en le comparant au référentiel validé (issu de `data/infos extraites CSS.xlsx`) avec une métrique de similarité tolérante, génère un rapport détaillé et enregistre le résultat.

Une documentation plus exhaustive est disponible dans `docs/README.md`.

## Prérequis

- Node.js ≥ 18
- npm
- (Optionnel mais recommandé) Netlify CLI pour les tests locaux complets

## Installation

```bash
npm install
```

### Générer/mettre à jour le référentiel JSON

```bash
node reference-generator.js "data/infos extraites CSS.xlsx" --out=data/reference.json
```

Le script lit le fichier Excel saisi de référence et produit un JSON utilisé par la fonction d’analyse.

## Lancer en local

### Option complète (front + fonction serverless)

```bash
npm install -g netlify-cli  # une seule fois
netlify dev
```

- Accès via l’URL indiquée par Netlify (souvent `http://localhost:8888`).
- Le proxy redirige `/.netlify/functions/analyze-upload` vers la fonction locale, permettant d’analyser un Excel et d’obtenir un score.

### Option front seul

```bash
npm run dev -- --host 127.0.0.1 --port 5174
```

- Sert uniquement l’interface Vite. L’analyse renverra une erreur tant que la fonction n’est pas démarrée.

## Déploiement Netlify

`netlify.toml` décrit la configuration :

```toml
[build]
  command = "npm run build"
  publish = "dist"

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
```

- **Build statique** : Netlify exécute `npm run build` (Vite) et publie `dist` sur le CDN.
- **Functions** : chaque fichier dans `netlify/functions/` est exposé sous `/.netlify/functions/<nom>` ; ici `analyze-upload`.

## Variables d’environnement (Google Sheets)

| Variable | Description |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email du service account avec droits sur le Google Sheet |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Clé privée (remplacer `\n` par des retours à la ligne réels) |
| `GOOGLE_SHEETS_ID` | Identifiant du Google Sheet destinataire |

Sans ces variables, l’analyse fonctionne mais l’archivage dans Google Sheets est désactivé (un message est renvoyé à l’utilisateur).

## Stockage des fichiers utilisateurs

La fonction utilise `@netlify/blobs` pour conserver une copie du fichier Excel soumis (`store: cosep-uploads`). En environnement local ou si Blobs est indisponible, la fonction continue son exécution et mentionne simplement que l’archivage n’a pas été effectué.

## Structure du projet

- `src/` : code React (UI, chrono, upload)
- `public/documents/` : documents mis à disposition des candidats (PDF)
- `data/reference.json` : référentiel généré depuis l’Excel validé
- `netlify/functions/analyze-upload.js` : analyse de conformité et archivage
- `reference-generator.js` : utilitaire pour mettre à jour `reference.json`
- `docs/` : documentation détaillée (architecture, scoring, checklist de déploiement)

## Prochaines évolutions possibles

- Ajouter le plan réel (`public/documents/plan.pdf`) ou adapter les liens dans `src/App.jsx`.
- Ajuster la pondération/les seuils de similarité dans la fonction d’analyse selon les retours.
- Brancher un moteur IA (Gemini, etc.) pour scorer du texte libre ou fournir des feedbacks qualitatifs.
