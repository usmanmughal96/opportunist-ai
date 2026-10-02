// Reliability & evaluation suite:  npm test
// Offline tests always run; set OH_OFFLINE=1 to skip the live network test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, planSearches, scoreCompany, discover, runAgent } from '../server/agent.mjs';
import { demoOpportunities } from '../server/demo.mjs';
import { writeCsv, COLUMNS } from '../server/sheets.mjs';

const Q = 'Find Python/C++ opportunities in Singapore for someone interested in AI, trading and crypto.';

test('intent parser is location-agnostic and extracts skills/categories', async () => {
  const i = await parseIntent(Q);
  assert.equal(i.location, 'Singapore');
  assert.ok(i.skills.includes('Python') && i.skills.includes('C++'));
  assert.ok(['AI', 'Trading', 'Crypto'].every((c) => i.categories.includes(c)));
});

test('planner generates ecosystem queries (university, trading, VC, hackathons, X)', async () => {
  const i = await parseIntent(Q);
  const plan = planSearches(i);
  for (const kw of ['career fair', 'trading', 'VC portfolio', 'hackathon', 'x.com']) assert.ok(plan.some((p) => p.includes(kw)), kw);
});

test('score is bounded 0–100, explainable, and components sum to total', async () => {
  const i = await parseIntent(Q);
  for (const o of demoOpportunities(i)) {
    assert.ok(o.score >= 0 && o.score <= 100);
    assert.ok(o.why.length > 0);
    assert.equal(Object.values(o.breakdown).reduce((a, b) => a + b, 0), o.score);
  }
});

test('word-boundary matching: "AI" does not match "email"', async () => {
  const i = { skills: ['Go'], categories: ['AI'], location: 'Amsterdam' };
  const o = scoreCompany({ company: 'X', role: 'Support', industry: '', description: 'send us an email', signals: [], sources: ['s'], sourceWeight: 1 }, i);
  assert.ok(!o.why.some((w) => w.startsWith('Industry match')));
});

test('CSV export has all 21 Sheet columns and labels demo rows', async () => {
  const i = await parseIntent(Q);
  const { csv } = writeCsv(demoOpportunities(i), 'demo');
  assert.equal(COLUMNS.length, 21);
  assert.ok(csv.split('\n')[0].includes('Opportunity Score'));
  assert.ok(csv.includes('DEMO DATA'));
});

test('graceful degradation: every source failing still returns a result, no crash', async () => {
  process.env.OH_FORCE_FAIL = 'freelancer_leads,web_search,google_maps,openstreetmap,github,hn_hiring,arbeitnow,remotive';
  const events = [];
  const i = await parseIntent(Q); planSearches(i);
  const r = await discover(i, (e, d) => events.push(d));
  delete process.env.OH_FORCE_FAIL;
  assert.equal(r.companies.length, 0);
  assert.ok(events.every((e) => ['skipped', 'failed', 'running'].includes(e.status)));
});

test('live end-to-end run hits ≥3 external apps', { skip: process.env.OH_OFFLINE === '1' }, async () => {
  const events = [];
  const r = await runAgent('Find Python opportunities in Amsterdam in AI', {}, (e, d) => e === 'source' && events.push(d));
  const ok = events.filter((e) => e.status === 'ok');
  console.log('sources ok:', ok.map((e) => `${e.app}(${e.count})`).join(', '), '| opportunities:', r.opportunities.length);
  assert.ok(new Set(ok.map((e) => e.app)).size >= 3);
  assert.ok(r.opportunities.length > 0);
  assert.ok(r.opportunities.every((o) => o.sourceUrls.some(Boolean)), 'every opportunity has a source URL');
});
