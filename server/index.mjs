// OpportunityHunter API server (zero dependencies). Streams the agent trace over Server-Sent Events.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { env, ROOT } from './env.mjs';
import { LIVE_SOURCES, SOURCE_REGISTRY } from './sources.mjs';
import { runAgent, parseIntent, planSearches } from './agent.mjs';
import { demoOpportunities, DEMO_SOURCE_EVENTS } from './demo.mjs';
import { syncToSheets, sheetsConfigured, writeCsv } from './sheets.mjs';

const PORT = Number(env('PORT') || 8787);
const runs = { live: null, demo: null }; // last results per mode
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });

function health() {
  const apps = [
    ...LIVE_SOURCES.map((s) => ({ id: s.id, name: s.name, app: s.app, configured: s.configured() })),
    { id: 'google_sheets', name: 'Google Sheets', app: 'Google Sheets API', configured: sheetsConfigured() },
    { id: 'claude', name: 'Claude intent parser', app: 'Anthropic API', configured: !!env('ANTHROPIC_API_KEY') },
    { id: 'csv', name: 'CSV export', app: 'Local file', configured: true },
  ];
  return { apps, available: apps.filter((a) => a.configured).length, total: apps.length, registry: SOURCE_REGISTRY };
}

async function handleRun(req, res, url) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const query = url.searchParams.get('q') || 'Find Python/C++ opportunities in Amsterdam related to AI, trading and crypto';
  const mode = url.searchParams.get('mode') === 'live' ? 'live' : 'demo';
  const list = (k) => (url.searchParams.get(k) || '').split(',').map((s) => s.trim()).filter(Boolean);
  const overrides = { location: url.searchParams.get('location'), country: url.searchParams.get('country'), skills: list('skills'), categories: list('categories') };
  const t0 = Date.now();
  try {
    let result;
    if (mode === 'live') {
      result = await runAgent(query, overrides, emit);
    } else {
      // DEMO: same planner + scorer, sample discovery data, paced for a video.
      emit('step', { stage: 'intent', text: 'Parsing intent… (DEMO MODE — sample data)' });
      const intent = await parseIntent(query, overrides);
      emit('intent', intent); await sleep(500);
      emit('plan', { queries: planSearches(intent) }); await sleep(700);
      emit('step', { stage: 'discovery', text: 'Fanning out to ecosystem sources… (sample)' });
      for (const [id, name, app, count] of DEMO_SOURCE_EVENTS) {
        emit('source', { id, name, app, status: 'running' }); await sleep(250);
        emit('source', { id, name, app, status: 'ok', count, ms: 200 + Math.round(Math.random() * 900), demo: true });
      }
      emit('step', { stage: 'dedup', text: '145 raw signals → 127 unique companies after deduplication (sample)' }); await sleep(600);
      emit('step', { stage: 'research', text: 'Researching top candidates: careers pages, ATS, public contact pages… (sample)' }); await sleep(900);
      const opportunities = demoOpportunities(intent);
      emit('step', { stage: 'score', text: `Scored ${opportunities.length} opportunities · ${opportunities.filter((o) => o.priority === 'HIGH').length} high priority (sample)` });
      result = { intent, opportunities, mode: 'demo' };
    }
    result.durationMs = Date.now() - t0;
    runs[mode] = result;
    writeCsv(result.opportunities, mode);
    emit('result', result);
  } catch (e) {
    emit('error', { message: e.message });
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); return res.end(); }
  try {
    if (url.pathname === '/api/health') return send(res, 200, health());
    if (url.pathname === '/api/run') return handleRun(req, res, url);
    if (url.pathname === '/api/sync' && req.method === 'POST') {
      const { mode = 'demo' } = await readBody(req);
      const run = runs[mode];
      if (!run) return send(res, 400, { error: `No ${mode} run yet — run the agent first.` });
      try { return send(res, 200, await syncToSheets(run.opportunities, mode)); }
      catch (e) { return send(res, 502, { sheets: false, error: e.message, csvFile: writeCsv(run.opportunities, mode).file }); }
    }
    if (url.pathname === '/api/export.csv') {
      const run = runs[url.searchParams.get('mode') === 'live' ? 'live' : 'demo'];
      if (!run) return send(res, 400, { error: 'No run yet' });
      res.setHeader('Content-Disposition', `attachment; filename="opportunities-${run.mode}.csv"`);
      return send(res, 200, writeCsv(run.opportunities, run.mode).csv, 'text/csv');
    }
    // Serve built dashboard if present
    const dist = path.join(ROOT, 'web', 'dist');
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (fs.existsSync(dist) && file.startsWith(dist)) {
      const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      return send(res, 200, fs.readFileSync(target), types[path.extname(target)] || 'application/octet-stream');
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`OpportunityHunter API on http://localhost:${PORT}`));
