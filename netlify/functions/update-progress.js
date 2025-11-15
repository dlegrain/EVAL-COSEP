import {
  applyProgressUpdates,
  ensureIdentityFields,
  findOrCreateProgressRow,
  getSheetsClient,
  parseProgressRow,
  writeProgressRow,
} from './_shared/googleSheetProgress.js';

const jsonResponse = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Méthode non autorisée.' });
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const email = payload.email?.trim();
    const firstName = payload.firstName?.trim() || '';
    const lastName = payload.lastName?.trim() || '';
    const updates = payload.updates || {};

    if (!email) {
      return jsonResponse(400, { error: "L'email est obligatoire pour mettre à jour la progression." });
    }
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return jsonResponse(400, { error: 'Aucune mise à jour fournie.' });
    }

    const { sheets, sheetId } = await getSheetsClient();
    const { rowIndex, rowValues } = await findOrCreateProgressRow({
      sheets,
      sheetId,
      email,
      firstName,
      lastName,
    });

    let workingRow = rowValues;
    let changed = false;

    const identityResult = ensureIdentityFields(workingRow, { firstName, lastName });
    if (identityResult.changed) {
      workingRow = identityResult.rowValues;
      changed = true;
    }

    const progressResult = applyProgressUpdates(workingRow, updates);
    if (progressResult.changed) {
      workingRow = progressResult.rowValues;
      changed = true;
    }

    if (changed) {
      await writeProgressRow({ sheets, sheetId, rowIndex, rowValues: workingRow });
    }

    const parsed = parseProgressRow(workingRow);

    return jsonResponse(200, {
      user: {
        email: parsed.email,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
      },
      progress: parsed.modules,
      updatedModules: Object.keys(updates),
    });
  } catch (error) {
    console.error('update-progress error:', error);
    const statusCode = /env variables/i.test(error.message) ? 503 : 500;
    return jsonResponse(statusCode, {
      error:
        statusCode === 503
          ? 'Configuration Google Sheets manquante. Impossible de sauvegarder la progression.'
          : `Impossible de sauvegarder la progression: ${error.message}`,
    });
  }
};
