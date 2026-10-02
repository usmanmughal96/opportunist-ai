// Renders a Google-Sheets-style preview of the exact rows the Sheets sync writes (DEMO data, no private contacts).
// Usage: node scripts/sheet_preview.mjs  → screenshots/sheet-preview.html (+ PNG via headless Edge/Chrome)
import fs from 'node:fs';
import { parseIntent } from '../server/agent.mjs';
import { demoOpportunities } from '../server/demo.mjs';
import { writeCsv, COLUMNS } from '../server/sheets.mjs';

const intent = await parseIntent('Find Python/C++ opportunities in Amsterdam for someone interested in AI, trading and crypto.');
const opps = demoOpportunities(intent);
const rows = writeCsv(opps, 'demo').csv.split('\n').slice(1).map((l) => [...l.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"')));
const show = [0, 2, 3, 5, 7, 8, 14, 15, 16, 17, 18];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const color = (v) => (v >= 75 ? '#b7e1cd' : v >= 55 ? '#fff2cc' : '#f4cccc');
const letters = 'ABCDEFGHIJKLMNOPQRSTU';
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font:13px Arial,sans-serif;background:#f8f9fa;color:#202124}
.bar{background:#fff;padding:10px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #dadce0}
.logo{width:28px;height:36px;background:#0f9d58;border-radius:3px;position:relative}.logo:after{content:"";position:absolute;inset:12px 6px 8px;border:2px solid #fff;border-radius:1px}
.title{font-size:18px}.sub{font-size:12px;color:#5f6368}.share{margin-left:auto;background:#c2e7ff;padding:8px 18px;border-radius:18px;font-weight:600}
.badge{background:#fef7e0;color:#b06000;border:1px solid #f9ab00;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700}
.fx{background:#fff;padding:6px 16px;border-bottom:1px solid #dadce0;color:#5f6368;font-size:12px}
table{border-collapse:collapse;background:#fff}td,th{border:1px solid #e2e3e3;padding:6px 8px;vertical-align:top}
.cl th{background:#f8f9fa;color:#5f6368;font-weight:400;font-size:11px;padding:2px}
.hd th{background:#1e1b4b;color:#fff;font-weight:700;font-size:11.5px;height:34px}
.rn{background:#f8f9fa;color:#5f6368;text-align:center;font-size:11px;width:28px}
tr:nth-child(even) td:not(.rn){background:#f3f0ff}
td.co{font-weight:700;white-space:nowrap}td.why{width:340px;font-size:12px}td.url{color:#1a73e8;text-decoration:underline;max-width:170px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
td.sc{text-align:center;font-weight:700}.st{background:#e8f0fe;color:#1967d2;border-radius:10px;padding:1px 8px;font-size:11px}
.tabs{background:#f1f3f4;border-top:1px solid #dadce0;padding:6px 16px;display:flex;gap:4px;font-size:12px}.tabs span{padding:6px 14px;border-radius:4px 4px 0 0;color:#5f6368}.tabs .on{background:#fff;color:#188038;font-weight:700;border-bottom:3px solid #188038}
</style>
<div class="bar"><div class="logo"></div><div><div class="title">OpportunityHunter — Opportunities <span class="badge">SAMPLE · DEMO DATA</span></div><div class="sub">File Edit View Insert Format Data Tools Extensions Help</div></div><div class="share">🔒 Share</div></div>
<div class="fx">fx &nbsp; Rows appended by the agent · 21 columns (subset shown) · score colour scale · filter · frozen header · status dropdown</div>
<table><tr class="cl"><th></th>${show.map((i) => `<th>${letters[i]}</th>`).join('')}</tr>
<tr class="hd"><th class="rn">1</th>${show.map((i) => `<th>${COLUMNS[i]} ▾</th>`).join('')}</tr>
${rows.map((r, n) => `<tr><td class="rn">${n + 2}</td>${show.map((i) => {
  const v = r[i] || '';
  if (i === 0) return `<td class="co">${esc(v)}</td>`;
  if (i === 14) return `<td class="sc" style="background:${color(+v)}">${v}</td>`;
  if (i === 15) return `<td class="why">${esc(v)}</td>`;
  if (i === 7 || i === 9) return `<td class="url">${esc(v)}</td>`;
  if (i === 18) return `<td><span class="st">${v} ▾</span></td>`;
  return `<td>${esc(v)}</td>`;
}).join('')}</tr>`).join('')}
</table>
<div class="tabs"><span>+</span><span class="on">Opportunities</span><span>Companies</span><span>Application Tracker</span></div>`;
fs.writeFileSync('screenshots/sheet-preview.html', html);
console.log('wrote screenshots/sheet-preview.html with', rows.length, 'rows');
