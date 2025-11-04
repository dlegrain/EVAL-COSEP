#!/usr/bin/env node
/**
 * Script de génération d'un JSON de référence à partir d'un fichier Excel.
 *
 * Utilisation :
 *   node reference-generator.js [chemin/vers/fichier.xlsx] [chemin/vers/sortie.json]
 *     --sheet=NomDeFeuille       (optionnel) feuille à lire quand le classeur en contient plusieurs
 *
 * Par défaut :
 *   - Le fichier Excel lu est `data/rapport_final.xlsx`
 *   - Le JSON est affiché sur la sortie standard (stdout). Si un chemin est renseigné, il sera écrit sur disque.
 */

import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';

const DEFAULT_INPUT = 'data/rapport_final.xlsx';

/**
 * Parse les arguments de la ligne de commande.
 * Retourne un objet { inputPath, outputPath, sheetName }.
 */
function parseArguments(argv) {
  let inputPath = DEFAULT_INPUT;
  let outputPath = null;
  let sheetName = null;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printHelpAndExit();
    } else if (arg.startsWith('--sheet=')) {
      sheetName = arg.slice('--sheet='.length).trim() || null;
    } else if (arg.startsWith('--out=')) {
      outputPath = arg.slice('--out='.length).trim() || null;
    } else if (arg.startsWith('--')) {
      console.error(`Option inconnue : ${arg}`);
      printHelpAndExit(1);
    } else if (inputPath === DEFAULT_INPUT) {
      inputPath = arg;
    } else if (!outputPath) {
      outputPath = arg;
    } else {
      console.error(`Argument inattendu : ${arg}`);
      printHelpAndExit(1);
    }
  }

  return { inputPath, outputPath, sheetName };
}

/**
 * Affiche une aide succincte puis termine le programme.
 */
function printHelpAndExit(exitCode = 0) {
  console.log(`
Usage : node reference-generator.js [fichier.xlsx] [fichier.json]

Options :
  --sheet=<nom>   Nom de la feuille à lire si le classeur en contient plusieurs.
  --out=<fichier> Chemin du fichier JSON à écrire. Peut aussi être fourni en second argument.
  --help, -h      Affiche cette aide.

Comportement par défaut :
  - Lecture de ${DEFAULT_INPUT}
  - Écriture sur stdout
  `);
  process.exit(exitCode);
}

/**
 * Nettoie la clé telle qu'elle apparaît dans le fichier Excel.
 */
function normaliseKey(rawKey) {
  if (rawKey === undefined || rawKey === null) {
    return null;
  }

  const key = String(rawKey).trim();
  return key.length > 0 ? key : null;
}

/**
 * Prépare la valeur à stocker dans le JSON de sortie.
 * - Une colonne -> valeur directe
 * - Plusieurs colonnes -> objet avec des intitulés jugés pertinents
 */
function buildValue(cells, headerRow) {
  if (!cells.length) {
    return null;
  }

  if (cells.length === 1) {
    return cells[0];
  }

  const [primary, ...others] = cells;
  const value = { value: primary };

  others.forEach((cell, index) => {
    const header = headerRow && headerRow[index + 1] ? String(headerRow[index + 1]).trim() : null;
    const key = header && header.length > 0 ? header : `extra_${index + 1}`;
    value[key] = cell;
  });

  return value;
}

/**
 * Transforme un tableau de lignes (chaque ligne = tableau de cellules) en dictionnaire clé/valeur.
 */
function rowsToReference(rows) {
  if (!rows.length) {
    return {};
  }

  const [headerRow, ...dataRows] = rows;
  const reference = {};

  for (const row of dataRows) {
    if (!row || row.length === 0) {
      continue;
    }

    const [rawKey, ...rest] = row;
    const key = normaliseKey(rawKey);
    if (!key) {
      continue;
    }

    const value = buildValue(rest, headerRow);

    if (Object.prototype.hasOwnProperty.call(reference, key)) {
      const existing = reference[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        reference[key] = [existing, value];
      }
    } else {
      reference[key] = value;
    }
  }

  return reference;
}

function main() {
  const { inputPath, outputPath, sheetName } = parseArguments(process.argv.slice(2));
  const resolvedInput = path.resolve(process.cwd(), inputPath);

  if (!fs.existsSync(resolvedInput)) {
    console.error(`Fichier introuvable : ${resolvedInput}`);
    process.exit(1);
  }

  const workbook = xlsx.readFile(resolvedInput, { cellDates: true });
  const selectedSheet = sheetName || workbook.SheetNames[0];

  if (!workbook.SheetNames.includes(selectedSheet)) {
    console.error(`La feuille "${selectedSheet}" n'existe pas dans ${resolvedInput}. Feuilles disponibles : ${workbook.SheetNames.join(', ')}`);
    process.exit(1);
  }

  const worksheet = workbook.Sheets[selectedSheet];
  const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: null });

  const reference = rowsToReference(rows);
  const outputJson = JSON.stringify(reference, null, 2);

  if (outputPath) {
    const resolvedOutput = path.resolve(process.cwd(), outputPath);
    fs.writeFileSync(resolvedOutput, `${outputJson}\n`, 'utf-8');
    console.log(`JSON de référence écrit dans : ${resolvedOutput}`);
  } else {
    process.stdout.write(`${outputJson}\n`);
  }
}

main();
