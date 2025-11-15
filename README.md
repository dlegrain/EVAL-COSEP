# EVAL COSEP – prototype d'évaluation automatisée

Plateforme d'évaluation modulaire destinée à mesurer les compétences d'un coordinateur COSEP. Elle comprend **4 modules indépendants** accessibles via un dashboard interactif.

## 🎯 Modules d'évaluation

1. **Module 1 — Extraction du cahier des charges** (30 min)
   Analyser des documents PDF et extraire les informations dans un fichier Excel structuré.

2. **Module 2 — Collaboration humain–IA** (sans limite)
   Évaluation de la qualité du dialogue avec une IA (ChatGPT, Gemini, etc.) : pertinence des prompts, exploitation des réponses, itérations constructives.

3. **Module 3 — Législation (recherche)** (10 min)
   Recherche et interprétation de la réglementation sur la formation sécurité en construction (AR 7 avril 2023, CP 124, CCT).

4. **Module 4 — Preuve Canvas (ChatGPT)** (sans limite)
   Vérification de l'accès à l'outil Canvas de ChatGPT via analyse d'image par Gemini 2.0 Flash.

## 🎨 Interface utilisateur

- **Navigation modulaire** : Dashboard → Détail module → Module actif → Retour au dashboard
- **Système de scoring visuel** : badges colorés (🟢 vert ≥95%, 🟠 orange 90-95%, 🔴 rouge <90%)
- **Modules terminés désactivés** : empêche les tentatives multiples
- **Sessions strictes** : une fois un module évalué, l'interface masque le formulaire et seul le retour au dashboard est possible (plus de bouton « réinitialiser » côté candidat)
- **Rapport PDF unifié** : récapitulatif de tous les modules avec détails par section

## 🔐 Gestion des sessions & progression

- **Login** : email + prénom + nom → POST `/.netlify/functions/get-progress`. La fonction lit (ou crée) la ligne associée dans Google Sheets (`Progress`) et renvoie l'état des 4 modules.
- **Feuille `Progress`** : colonnes `email`, `first_name`, `last_name`, puis pour chaque module `moduleX_status`, `moduleX_score`, `moduleX_elapsed_ms`, `moduleX_updated_at`. L'email (normalisé) est utilisé comme clé unique.
- **Verrouillage automatique** : après chaque soumission réussie, le front appelle `/.netlify/functions/update-progress` qui ne modifie que les colonnes du module concerné. Les boutons du dashboard restent fermés pour les modules dont le statut est `completed`.
- **Reconnexion** : un utilisateur peut quitter l'interface, revenir plus tard, saisir le même email et retrouver son état exact (colonnes existantes inchangées).

## ⚙️ Architecture technique

- **Front** : React/Vite avec navigation par état (flat design moderne)
- **Backend** : Netlify Functions serverless
  - `analyze-upload.js` : analyse Excel (module 1)
  - `analyze-collaboration.js` : évaluation dialogue IA (module 2)
  - `evaluate-legal-training.js` : correction questions législation (module 3)
  - `detect-canvas-icon.js` : détection Canvas via Gemini 2.0 Flash (module 4)
  - `get-progress.js` : lecture/initialisation de la feuille Google Sheets `Progress`
  - `update-progress.js` : mise à jour partielle des colonnes `moduleX_*`
- **Stockage** : Netlify Blobs + Google Sheets (archivage et traçabilité)

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

Le script lit le fichier Excel saisi de référence et produit un JSON utilisé par la fonction d'analyse.

## Lancer en local

### Option complète (front + fonction serverless)

```bash
npm install -g netlify-cli  # une seule fois
netlify dev
```

- Accès via l'URL indiquée par Netlify (souvent `http://localhost:8888`).
- Le proxy redirige `/.netlify/functions/*` vers les fonctions locales, permettant de tester tous les modules.

### Option front seul

```bash
npm run dev -- --host 127.0.0.1 --port 5174
```

- Sert uniquement l'interface Vite. Les analyses renverront une erreur tant que les fonctions ne sont pas démarrées.

## Déploiement Netlify

`netlify.toml` décrit la configuration :

```toml
[build]
  command = "npm run build"
  publish = "dist"

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
```

- **Build statique** : Netlify exécute `npm run build` (Vite) et publie `dist` sur le CDN.
- **Functions** : chaque fichier dans `netlify/functions/` est exposé sous `/.netlify/functions/<nom>`.
  - Endpoints : `analyze-upload`, `analyze-collaboration`, `evaluate-legal-training`, `detect-canvas-icon`.

## Variables d'environnement (Google Sheets)

| Variable | Description |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email du service account avec droits sur le Google Sheet |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Clé privée (remplacer `\n` par des retours à la ligne réels) |
| `GOOGLE_SHEETS_ID` | Identifiant du Google Sheet destinataire |

Sans ces variables, l'analyse fonctionne mais l'archivage dans Google Sheets est désactivé (un message est renvoyé à l'utilisateur).

## Variables d'environnement (Gemini)

| Variable | Description |
| --- | --- |
| `GEMINI_API_KEY` | Clé API Google Generative AI utilisée par les fonctions (analyse collaboration, législation, détection Canvas). |

## Stockage des fichiers utilisateurs

Les fonctions utilisent `@netlify/blobs` pour conserver des copies des fichiers soumis (`store: cosep-uploads`). En environnement local ou si Blobs est indisponible, les fonctions continuent leur exécution et mentionnent simplement que l'archivage n'a pas été effectué.

## Structure du projet

- `src/` : code React (UI, navigation modulaire, chronos, uploads)
- `public/documents/` : documents mis à disposition des candidats (PDF)
- `data/reference.json` : référentiel généré depuis l'Excel validé (module 1)
- `netlify/functions/` : fonctions serverless (analyse, collaboration, législation, Canvas, progression)
- `reference-generator.js` : utilitaire pour mettre à jour `reference.json`
- `docs/` : documentation détaillée (architecture, scoring, checklist de déploiement)

## Prochaines évolutions possibles

- Ajouter d'autres modules d'évaluation (ex: communication, gestion de projet)
- Améliorer les prompts Gemini pour une détection plus robuste
- Ajouter un tableau de bord administrateur pour suivre les résultats en temps réel
- Exporter les données vers d'autres formats (CSV, JSON)
