// DARKMATTER agent pipeline:
// INTENT → PLAN → MULTI-SOURCE DISCOVERY → DEDUP → WEBSITE/CAREERS RESEARCH → QUALIFY → SCORE
import { env, http } from './env.mjs';
import { LIVE_SOURCES, matchesSkills } from './sources.mjs';

const SKILLS = ['Python', 'C++', 'Rust', 'Golang', 'TypeScript', 'Java', 'Solana', 'ML', 'Kotlin', 'React', 'SQL'];
const CATEGORIES = { software: 'Software', ai: 'AI', fintech: 'Fintech', quant: 'Quant', trading: 'Trading', crypto: 'Crypto', blockchain: 'Crypto', web3: 'Crypto', gaming: 'Gaming', health: 'Healthtech', restaurant: 'Restaurants', cafe: 'Cafes', gym: 'Gyms' };
const CITIES = { amsterdam: 'Netherlands', rotterdam: 'Netherlands', singapore: 'Singapore', dubai: 'United Arab Emirates', london: 'United Kingdom', berlin: 'Germany', 'new york': 'United States', 'san francisco': 'United States', toronto: 'Canada', 'hong kong': 'Hong Kong', tokyo: 'Japan', paris: 'France', munich: 'Germany', zurich: 'Switzerland' };
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// ---------- 1. INTENT PARSER (Claude if configured, deterministic otherwise) ----------
export async function parseIntent(query, overrides = {}) {
  const q = query.toLowerCase();
  const cityKey = Object.keys(CITIES).find((c) => q.includes(c)) || 'amsterdam';
  let intent = {
    query,
    location: cap(cityKey),
    country: CITIES[cityKey],
    skills: SKILLS.filter((s) => new RegExp(`(^|[^a-z])${s.replace(/\+/g, '\\+').toLowerCase()}([^a-z+]|$)`).test(q)),
    categories: [...new Set(Object.entries(CATEGORIES).filter(([k]) => q.includes(k)).map(([, v]) => v))],
    parser: 'rules',
  };
  if (env('ANTHROPIC_API_KEY')) {
    try {
      const r = await http('https://api.anthropic.com/v1/messages', {
        method: 'POST', timeout: 15000,
        headers: { 'content-type': 'application/json', 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: env('ANTHROPIC_MODEL') || 'claude-sonnet-5', max_tokens: 400,
          messages: [{ role: 'user', content: `Extract a job-search intent as JSON only, keys: location (city), country, skills (array), categories (array of industries). Request: "${query}"` }],
        }),
      });
      const text = r.body?.content?.[0]?.text || '';
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      intent = { ...intent, ...parsed, query, parser: 'claude' };
    } catch { /* fall back to rule-based intent silently; reported in the trace */ }
  }
  intent = { ...intent, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v && (!Array.isArray(v) || v.length))) };
  if (!intent.skills.length) intent.skills = ['Python'];
  if (!intent.categories.length) intent.categories = ['Software'];
  return intent;
}

// ---------- 2. SEARCH PLANNER ----------
export function planSearches(intent) {
  const L = intent.location;
  intent.ecosystemQueries = [
    { ecosystem: 'University career fair', query: `${L} university career fair 2026 companies ${intent.categories[0]}` },
    { ecosystem: 'Trading ecosystem', query: `quant trading firms market makers ${L} careers` },
    { ecosystem: 'VC portfolio', query: `${L} ${intent.categories.join(' ')} startups VC portfolio hiring engineers` },
    { ecosystem: 'Hackathon sponsors', query: `${L} hackathon 2026 sponsors ${intent.skills[0]}` },
    ...(/dubai|uae|emirates/i.test(`${L} ${intent.country}`) ? [{ ecosystem: 'DMCC directory', query: `site:dmcc.ae business directory ${intent.categories[0]} company` }, { ecosystem: 'DMCC crypto centre', query: `DMCC Crypto Centre member companies ${intent.categories.join(' ')}` }] : []),
    { ecosystem: 'X / Twitter', query: `site:x.com "hiring" ${intent.skills[0]} ${L}` },
  ];
  const plan = [
    ...intent.categories.map((c) => `${c} companies ${L}`),
    ...intent.skills.map((s) => `${s} developer ${L}`),
    ...intent.ecosystemQueries.map((e) => e.query),
    `GitHub orgs located in ${L}`, `HN “Who is hiring” mentions of ${L}`, `${L} startup hiring`,
  ];
  return plan;
}

// ---------- 3–4. DISCOVERY + DEDUP ----------
const norm = (s = '') => s.toLowerCase().replace(/\b(b\.?v\.?|inc|ltd|gmbh|llc|n\.v\.)\b/g, '').replace(/[^a-z0-9]/g, '');

export async function discover(intent, emit) {
  const settled = await Promise.allSettled(LIVE_SOURCES.map(async (src) => {
    if (!src.configured()) { emit('source', { id: src.id, name: src.name, app: src.app, status: 'skipped', detail: 'Not configured (API key missing)' }); return []; }
    emit('source', { id: src.id, name: src.name, app: src.app, status: 'running' });
    const t0 = Date.now();
    try {
      // Chaos hook for reliability tests: OH_FORCE_FAIL=github,openstreetmap
      if (env('OH_FORCE_FAIL').split(',').includes(src.id)) throw new Error('forced failure (chaos test)');
      const leads = await Promise.race([src.search(intent), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after 35s')), 35000))]);
      leads.forEach((l) => { l.source = src.name; l.sourceId = src.id; l.app = src.app; l.sourceWeight = src.weight; });
      emit('source', { id: src.id, name: src.name, app: src.app, status: 'ok', count: leads.length, ms: Date.now() - t0 });
      return leads;
    } catch (e) {
      emit('source', { id: src.id, name: src.name, app: src.app, status: 'failed', detail: e.message, ms: Date.now() - t0 });
      return [];
    }
  }));
  const all = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  const byKey = new Map();
  for (const l of all.filter((l) => l.company)) {
    const k = norm(l.company);
    if (!k) continue;
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, { ...l, sources: [l.source], sourceUrls: [l.sourceUrl] }); continue; }
    prev.sources = [...new Set([...prev.sources, l.source])];
    prev.sourceUrls.push(l.sourceUrl);
    prev.signals = [...new Set([...prev.signals, ...l.signals])];
    prev.people = [...(prev.people || []), ...(l.people || [])]; prev.founder ||= l.founder; prev.cto ||= l.cto; prev.recruiter ||= l.recruiter;
    prev.website ||= l.website; prev.careersUrl ||= l.careersUrl; prev.contact ||= l.contact;
    prev.sourceWeight = Math.max(prev.sourceWeight, l.sourceWeight);
  }
  return { raw: all.length, companies: [...byKey.values()] };
}

// ---------- 5. WEBSITE / CAREERS RESEARCH (public homepage only, robots-friendly single GET) ----------
const ATS = ['greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'recruitee.com', 'smartrecruiters.com', 'personio', 'teamtailor.com', 'join.com', 'workday'];
export async function researchCompany(c) {
  if (!c.website) return c;
  try {
    const r = await http(c.website, { json: false, timeout: 7000 });
    if (!r.ok) return c;
    const html = r.body.slice(0, 400000);
    const links = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
    const careers = links.find((h) => /career|jobs|vacatures|join-us|work-with-us|werken-bij/i.test(h));
    const ats = ATS.find((a) => html.includes(a));
    if (careers) {
      c.careersUrl ||= careers.startsWith('http') ? careers : new URL(careers, r.url).href;
      c.signals.push('Careers page linked from company website');
    }
    if (ats) c.signals.push(`Uses ATS: ${ats}`);
    const email = (html.match(/mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i) || [])[1];
    if (email && /^(jobs|careers|hr|recruit|info|hello|contact)/i.test(email)) c.contact ||= email; // only generic public role inboxes
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').toLowerCase();
    c.siteText = text.slice(0, 20000);
    c.researched = true;
  } catch { /* unreachable site — keep lead, lower contactability */ }
  return c;
}

// ---------- 6–7. QUALIFY + EXPLAINABLE SCORE (0–100) ----------
export function scoreCompany(c, intent) {
  const hay = `${c.company} ${c.role} ${c.industry} ${c.description} ${c.signals.join(' ')} ${c.siteText || ''}`.toLowerCase();
  const why = [];
  const word = (w) => new RegExp(`(^|[^a-z0-9])${w.toLowerCase().replace(/[+.]/g, '\\$&')}([^a-z0-9+]|$)`).test(hay);
  const matchedSkills = intent.skills.filter(word);
  const matchedCats = intent.categories.filter((k) => word(k) || (k === 'AI' && /machine learning|artificial intelligence|\bllm/.test(hay)) || (k === 'Quant' && /trading|market mak/.test(hay)) || (k === 'Crypto' && /blockchain|web3|bitcoin/.test(hay)));
  const technical = Math.min(25, 8 + matchedSkills.length * 7 + (/engineer|developer/.test(hay) ? 3 : 0));
  if (matchedSkills.length) why.push(`Skill match: ${matchedSkills.join(', ')}`);
  const relevance = Math.min(20, 6 + matchedCats.length * 7);
  if (matchedCats.length) why.push(`Industry match: ${matchedCats.join(', ')}`);
  const hiringHits = [/careers page/i, /vacancy|job post|hiring|actively/i, /ats:/i].filter((re) => c.signals.some((s) => re.test(s)) || re.test(c.opportunityType || '')).length;
  const hiring = Math.min(20, hiringHits * 8);
  if (hiringHits) why.push('Hiring signal: ' + c.signals.filter((s) => /career|vacancy|hiring|ats/i.test(s)).slice(0, 2).join('; '));
  const intl = /remote|relocat|visa|english|international|worldwide/.test(hay) ? 10 : c.city?.toLowerCase().includes(intent.location.toLowerCase()) ? 5 : 2;
  if (intl === 10) why.push('International / remote / relocation language found');
  const ageDays = c.updatedAt ? (Date.now() - new Date(c.updatedAt).getTime()) / 86400000 : 999;
  const recent = ageDays < 30 ? 10 : ageDays < 120 ? 6 : 2;
  if (ageDays < 120) why.push(`Recent activity (${Math.round(ageDays)} days ago)`);
  const unconventional = Math.min(10, c.sourceWeight + (c.sources.length > 1 ? 2 : 0));
  if (c.sourceWeight >= 7) why.push(`Found via unconventional ecosystem: ${c.sources.join(' + ')}`);
  const contact = (c.careersUrl ? 3 : 0) + (c.contact || c.website ? 2 : 0);
  const score = Math.round(technical + relevance + hiring + intl + recent + unconventional + contact);
  return {
    ...c, siteText: undefined, score, priority: score >= 75 ? 'HIGH' : score >= 55 ? 'MEDIUM' : 'LOW',
    breakdown: { technical, relevance, hiring, international: intl, recent, unconventional, contactability: contact },
    why: why.length ? why : ['Weak signals only — review manually'],
    technicalFit: matchedSkills.join(', ') || 'Unverified',
    visa: /visa|relocat/.test(hay) ? 'Mentions visa/relocation' : 'Unknown',
    status: 'New', discoveredAt: new Date().toISOString().slice(0, 10),
  };
}

export async function runAgent(query, overrides, emit) {
  emit('step', { stage: 'intent', text: 'Parsing intent…' });
  const intent = await parseIntent(query, overrides);
  emit('intent', intent);
  const plan = planSearches(intent);
  emit('plan', { queries: plan });
  emit('step', { stage: 'discovery', text: `Fanning out to ${LIVE_SOURCES.length} live connectors in parallel…` });
  const { raw, companies } = await discover(intent, emit);
  emit('step', { stage: 'dedup', text: `${raw} raw signals → ${companies.length} unique companies after deduplication` });
  const top = companies.slice(0, 30);
  emit('step', { stage: 'research', text: `Researching ${top.filter((c) => c.website).length} company websites for careers pages & ATS…` });
  await Promise.allSettled(top.map(researchCompany));
  const scored = top.map((c) => scoreCompany(c, intent)).sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => (s.id = `live-${i}`));
  emit('step', { stage: 'score', text: `Scored ${scored.length} opportunities · ${scored.filter((s) => s.priority === 'HIGH').length} high priority` });
  return { intent, opportunities: scored, mode: 'live' };
}
