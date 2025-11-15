import { google } from 'googleapis';

const SHEET_NAME = 'Progress';
const DEFAULT_STATUS = 'pending';

const MODULE_DEFINITIONS = [
  { id: 'module1' },
  { id: 'module2' },
  { id: 'module3' },
  { id: 'module4' },
];

const BASE_COLUMNS = ['email', 'first_name', 'last_name'];
const MODULE_COLUMNS = MODULE_DEFINITIONS.flatMap((module) => [
  `${module.id}_status`,
  `${module.id}_score`,
  `${module.id}_elapsed_ms`,
  `${module.id}_updated_at`,
]);
const PROGRESS_COLUMNS = [...BASE_COLUMNS, ...MODULE_COLUMNS];

const COLUMN_INDEX = PROGRESS_COLUMNS.reduce((acc, key, idx) => {
  acc[key] = idx;
  return acc;
}, {});

const COLUMN_LETTER = (index) => {
  let result = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
};

const LAST_COLUMN_LETTER = COLUMN_LETTER(PROGRESS_COLUMNS.length - 1);
const FULL_RANGE = `${SHEET_NAME}!A:${LAST_COLUMN_LETTER}`;
const EMAIL_RANGE = `${SHEET_NAME}!A:A`;

const normalizeEmail = (value = '') => value.trim().toLowerCase();
const parseNumber = (value) => {
  if (value === '' || value === undefined || value === null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const ensureRowShape = (rowValues = []) => {
  const row = Array.from(rowValues);
  while (row.length < PROGRESS_COLUMNS.length) {
    row.push('');
  }
  return row;
};

const getValue = (rowValues, columnKey) => {
  const index = COLUMN_INDEX[columnKey];
  return index === undefined ? '' : rowValues[index] ?? '';
};

const setValue = (rowValues, columnKey, value) => {
  const index = COLUMN_INDEX[columnKey];
  if (index === undefined) return;
  rowValues[index] = value ?? '';
};

const buildEmptyRow = ({ email, firstName, lastName }) => {
  const row = ensureRowShape([]);
  setValue(row, 'email', normalizeEmail(email));
  setValue(row, 'first_name', firstName?.trim() || '');
  setValue(row, 'last_name', lastName?.trim() || '');
  MODULE_DEFINITIONS.forEach(({ id }) => {
    setValue(row, `${id}_status`, DEFAULT_STATUS);
    setValue(row, `${id}_score`, '');
    setValue(row, `${id}_elapsed_ms`, '');
    setValue(row, `${id}_updated_at`, '');
  });
  return row;
};

const extractRowIndexFromRange = (range) => {
  if (!range) return null;
  const match = range.match(/![A-Z]+(\d+):/i);
  return match ? Number(match[1]) : null;
};

const getEnvConfig = () => {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, '\n');
  const sheetId = process.env.GOOGLE_SHEETS_ID;

  if (!clientEmail || !privateKey || !sheetId) {
    throw new Error('Google Sheets env variables are missing for progress tracking.');
  }
  return { clientEmail, privateKey, sheetId };
};

export const getSheetsClient = async () => {
  const { clientEmail, privateKey, sheetId } = getEnvConfig();
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  return { sheets, sheetId };
};

export const findProgressRow = async ({ sheets, sheetId, email }) => {
  const normalized = normalizeEmail(email);

  const { data: columnData } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: EMAIL_RANGE,
    majorDimension: 'COLUMNS',
  });
  const columnEntries = columnData.values?.[0] || [];
  const idx = columnEntries.findIndex((cell) => normalizeEmail(cell || '') === normalized);
  if (idx === -1) {
    return null;
  }

  const rowIndex = idx + 1; // Sheets rows are 1-based
  const rowRange = `${SHEET_NAME}!A${rowIndex}:${LAST_COLUMN_LETTER}${rowIndex}`;
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: rowRange,
  });
  const rowValues = ensureRowShape(data.values?.[0] || []);
  return { rowIndex, rowValues };
};

export const appendProgressRow = async ({ sheets, sheetId, email, firstName, lastName }) => {
  const rowValues = buildEmptyRow({ email, firstName, lastName });
  const result = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowValues] },
  });

  const updatedRange = result.data.updates?.updatedRange;
  const rowIndex = extractRowIndexFromRange(updatedRange);
  if (rowIndex) {
    return { rowIndex, rowValues };
  }

  // Fallback: reload column A to find the inserted row.
  const fallback = await findProgressRow({ sheets, sheetId, email });
  if (fallback) return fallback;

  throw new Error('Unable to determine row index after append.');
};

export const findOrCreateProgressRow = async ({ sheets, sheetId, email, firstName, lastName }) => {
  const existing = await findProgressRow({ sheets, sheetId, email });
  if (existing) {
    return existing;
  }

  const appended = await appendProgressRow({ sheets, sheetId, email, firstName, lastName });
  return appended;
};

export const ensureIdentityFields = (rowValues, { firstName, lastName }) => {
  const trimmedFirst = firstName?.trim();
  const trimmedLast = lastName?.trim();
  const nextRow = ensureRowShape(rowValues);
  let changed = false;
  if (trimmedFirst && getValue(nextRow, 'first_name') !== trimmedFirst) {
    setValue(nextRow, 'first_name', trimmedFirst);
    changed = true;
  }
  if (trimmedLast && getValue(nextRow, 'last_name') !== trimmedLast) {
    setValue(nextRow, 'last_name', trimmedLast);
    changed = true;
  }
  return { rowValues: nextRow, changed };
};

export const applyProgressUpdates = (rowValues, updates = {}) => {
  const nextRow = ensureRowShape(rowValues);
  let changed = false;

  Object.entries(updates || {}).forEach(([moduleId, data]) => {
    if (!data) return;
    const definition = MODULE_DEFINITIONS.find(({ id }) => id === moduleId);
    if (!definition) return;

    const statusKey = `${moduleId}_status`;
    const scoreKey = `${moduleId}_score`;
    const elapsedKey = `${moduleId}_elapsed_ms`;
    const updatedAtKey = `${moduleId}_updated_at`;

    if (data.status && getValue(nextRow, statusKey) !== data.status) {
      setValue(nextRow, statusKey, data.status);
      changed = true;
    }
    if (data.score !== undefined) {
      const scoreValue = data.score === null ? '' : String(data.score);
      if (getValue(nextRow, scoreKey) !== scoreValue) {
        setValue(nextRow, scoreKey, scoreValue);
        changed = true;
      }
    }
    if (data.elapsedMs !== undefined) {
      const elapsedValue = data.elapsedMs === null ? '' : String(data.elapsedMs);
      if (getValue(nextRow, elapsedKey) !== elapsedValue) {
        setValue(nextRow, elapsedKey, elapsedValue);
        changed = true;
      }
    }
    const timestamp = data.submittedAt ?? data.updatedAt ?? Date.now();
    const iso =
      typeof timestamp === 'number' ? new Date(timestamp).toISOString() : new Date(timestamp).toISOString();
    if (getValue(nextRow, updatedAtKey) !== iso) {
      setValue(nextRow, updatedAtKey, iso);
      changed = true;
    }
  });

  return { rowValues: nextRow, changed };
};

export const writeProgressRow = async ({ sheets, sheetId, rowIndex, rowValues }) => {
  const range = `${SHEET_NAME}!A${rowIndex}:${LAST_COLUMN_LETTER}${rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [ensureRowShape(rowValues)] },
  });
};

export const parseProgressRow = (rowValues) => {
  const shaped = ensureRowShape(rowValues);
  const modules = MODULE_DEFINITIONS.reduce((acc, { id }) => {
    acc[id] = {
      status: getValue(shaped, `${id}_status`) || DEFAULT_STATUS,
      score: parseNumber(getValue(shaped, `${id}_score`)),
      elapsedMs: parseNumber(getValue(shaped, `${id}_elapsed_ms`)),
      updatedAt: getValue(shaped, `${id}_updated_at`) || null,
    };
    return acc;
  }, {});

  return {
    email: getValue(shaped, 'email'),
    firstName: getValue(shaped, 'first_name'),
    lastName: getValue(shaped, 'last_name'),
    modules,
  };
};

export const moduleDefinitions = MODULE_DEFINITIONS;
export const progressColumns = PROGRESS_COLUMNS;
export const defaultStatus = DEFAULT_STATUS;
