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

    if (!email) {
      return jsonResponse(400, { error: 'Le champ email est obligatoire.' });
    }

    const { sheets, sheetId } = await getSheetsClient();
    const { rowIndex, rowValues } = await findOrCreateProgressRow({
      sheets,
      sheetId,
      email,
      firstName,
      lastName,
    });

    const edits = [];
    let workingRow = rowValues;

    const identityResult = ensureIdentityFields(workingRow, { firstName, lastName });
    if (identityResult.changed) {
      edits.push('identity');
      workingRow = identityResult.rowValues;
    }

    // Ensure modules at least marked pending on first creation
    const pendingResult = applyProgressUpdates(workingRow, {});
    if (pendingResult.changed) {
      edits.push('defaults');
      workingRow = pendingResult.rowValues;
    }

    if (edits.length > 0) {
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
    });
  } catch (error) {
    console.error('get-progress error:', error);
    const statusCode = /env variables/i.test(error.message) ? 503 : 500;
    return jsonResponse(statusCode, {
      error:
        statusCode === 503
          ? 'Configuration Google Sheets manquante. Impossible de récupérer la progression.'
          : `Impossible de récupérer la progression: ${error.message}`,
    });
  }
};
