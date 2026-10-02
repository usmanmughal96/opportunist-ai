// Persistence: Google Sheets (service account, zero-dependency JWT) + always-on CSV fallback.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env, http, ROOT } from './env.mjs';

export const COLUMNS = ['Company', 'Country', 'City', 'Industry', 'Opportunity Type', 'Role', 'Website', 'Careers URL', 'Source', 'Source URL', 'Founder', 'CTO', 'Recruiter', 'Public Professional Contact', 'Opportunity Score', 'Why This Is Interesting', 'Technical Fit', 'Visa / International Hiring', 'Status', 'Discovery Date', 'Notes'];

const row = (o, mode) => [o.company, o.country, o.city, o.industry, o.opportunityType, o.role, o.website, o.careersUrl, (o.sources || [o.source]).join(' + '), (o.sourceUrls || [o.sourceUrl]).filter(Boolean).join(' '),
  o.founder || '', o.cto || '', o.recruiter || '', o.contact || '', o.score, o.why.join(' • '), o.technicalFit, o.visa, o.status, o.discoveredAt, mode === 'demo' ? 'DEMO DATA — not real research' : 'Live agent run'].map((v) => (v ?? '').toString());

function credentials() {
  const file = env('GOOGLE_SERVICE_ACCOUNT_FILE');
  if (file && fs.existsSync(path.resolve(ROOT, file))) return JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'));
  if (env('GOOGLE_SERVICE_ACCOUNT_JSON')) return JSON.parse(env('GOOGLE_SERVICE_ACCOUNT_JSON'));
  return null;
}

export const sheetsConfigured = () => !!(credentials() && env('GOOGLE_SHEET_ID'));

async function accessToken(sa) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const r = await http('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sig}` });
  if (!r.ok) throw new Error(`Google auth failed: ${r.body?.error_description || r.status}`);
  return r.body.access_token;
}

// Styles the sheet: dark bold frozen header, filter, score colour scale, column widths, wrapped "why", status dropdown.
async function formatSheet(id, tab, auth) {
  const meta = await http(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets(properties(sheetId,title),bandedRanges)`, { headers: auth });
  const sheet = meta.body?.sheets?.find((s) => s.properties.title === tab);
  if (!sheet) throw new Error('tab not found');
  const sheetId = sheet.properties.sheetId;
  const col = (i) => ({ sheetId, startColumnIndex: i, endColumnIndex: i + 1, startRowIndex: 1 });
  const rgb = (h) => ({ red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 });
  const width = (i, px) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
  const requests = [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: rgb('1e1b4b'), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { foregroundColor: rgb('ffffff'), bold: true, fontSize: 10 } } }, fields: 'userEnteredFormat' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 42 }, fields: 'pixelSize' } },
    { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0 } } } },
    { addConditionalFormatRule: { index: 0, rule: { ranges: [col(14)], gradientRule: { minpoint: { type: 'NUMBER', value: '40', color: rgb('f4cccc') }, midpoint: { type: 'NUMBER', value: '65', color: rgb('fff2cc') }, maxpoint: { type: 'NUMBER', value: '90', color: rgb('b7e1cd') } } } } },
    { repeatCell: { range: col(14), cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { bold: true } } }, fields: 'userEnteredFormat(horizontalAlignment,textFormat)' } },
    { repeatCell: { range: col(0), cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
    { repeatCell: { range: col(15), cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)' } },
    { setDataValidation: { range: col(18), rule: { condition: { type: 'ONE_OF_LIST', values: ['New', 'Researching', 'Contacted', 'Applied', 'Interview', 'Offer', 'Rejected'].map((v) => ({ userEnteredValue: v })) }, showCustomUi: true } } },
    ...[[0, 180], [5, 220], [6, 180], [7, 200], [8, 180], [9, 200], [14, 90], [15, 360], [16, 120], [18, 110]].map(([i, px]) => width(i, px)),
  ];
  if (!sheet.bandedRanges?.length) requests.push({ addBanding: { bandedRange: { range: { sheetId, startRowIndex: 0 }, rowProperties: { headerColor: rgb('1e1b4b'), firstBandColor: rgb('ffffff'), secondBandColor: rgb('f3f0ff') } } } });
  const r = await http(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, { method: 'POST', headers: auth, body: JSON.stringify({ requests }) });
  if (!r.ok) throw new Error(r.body?.error?.message || r.status);
  return 'styled';
}

export function writeCsv(opps, mode) {
  const dir = path.join(ROOT, 'data', 'private');
  fs.mkdirSync(dir, { recursive: true });
  const esc = (v) => `"${v.replace(/"/g, '""')}"`;
  const csv = [COLUMNS, ...opps.map((o) => row(o, mode))].map((r) => r.map(esc).join(',')).join('\n');
  const file = path.join(dir, `opportunities-${mode}.csv`);
  fs.writeFileSync(file, csv);
  return { file: path.relative(ROOT, file), csv };
}

export async function syncToSheets(opps, mode) {
  const csv = writeCsv(opps, mode);
  if (!sheetsConfigured()) return { sheets: false, reason: 'Google Sheets not configured (set GOOGLE_SHEET_ID + service account). Saved CSV instead.', csvFile: csv.file, rows: opps.length };
  const token = await accessToken(credentials());
  const id = env('GOOGLE_SHEET_ID');
  const tab = env('GOOGLE_SHEET_TAB') || 'Sheet1';
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const existing = await http(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(tab)}!A1:A1`, { headers: auth });
  if (!existing.ok) throw new Error(`Sheets read failed: ${existing.body?.error?.message || existing.status}`);
  const values = [...(existing.body.values ? [] : [COLUMNS]), ...opps.map((o) => row(o, mode))];
  const r = await http(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', headers: auth, body: JSON.stringify({ values }) });
  if (!r.ok) throw new Error(`Sheets append failed: ${r.body?.error?.message || r.status}`);
  const formatted = await formatSheet(id, tab, auth).catch((e) => `formatting skipped: ${e.message}`);
  return {
    formatted, sheets: true, rows: opps.length, updatedRange: r.body.updates?.updatedRange, url: `https://docs.google.com/spreadsheets/d/${id}`, csvFile: csv.file };
}
