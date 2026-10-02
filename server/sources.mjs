// UNCONVENTIONAL SOURCE ENGINE
// Every source implements: { id, name, app, ecosystem, weight, configured(), search(intent) -> Lead[] }
// A Lead is a raw company/opportunity signal with a source URL. Adding a source = adding one object here.
import fs from 'node:fs';
import { env, http } from './env.mjs';

const strip = (s = '') => s.replace(/<[^>]+>/g, ' ').replace(/&#x2F;/g, '/').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const lead = (o) => ({ signals: [], tags: [], country: '', city: '', ...o });

// ---------------- APP: GitHub (public REST API, token optional) ----------------
const github = {
  id: 'github', name: 'GitHub Organizations', app: 'GitHub', ecosystem: 'Open Source', weight: 8,
  configured: () => true,
  async search(intent) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (env('GITHUB_TOKEN')) headers.Authorization = `Bearer ${env('GITHUB_TOKEN')}`;
    const lang = intent.skills.find((s) => ['Python', 'C++', 'Rust', 'Go', 'TypeScript', 'Java'].includes(s)) || '';
    const q = `type:org location:"${intent.location}"${lang ? ` language:${lang === 'C++' ? 'cpp' : lang}` : ''}`;
    const r = await http(`https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=12`, { headers });
    if (!r.ok) throw new Error(`GitHub search HTTP ${r.status}`);
    const orgs = (r.body.items || []).slice(0, 8);
    // Enrich orgs with profile (website, description) — best effort, individual failures tolerated.
    const detailed = await Promise.allSettled(orgs.map((o) => http(`https://api.github.com/orgs/${o.login}`, { headers, timeout: 8000 })));
    return orgs.map((o, i) => {
      const d = detailed[i].status === 'fulfilled' && detailed[i].value.ok ? detailed[i].value.body : {};
      const website = d.blog ? (d.blog.startsWith('http') ? d.blog : `https://${d.blog}`) : '';
      return lead({
        company: d.name || o.login, website, city: intent.location, country: intent.country,
        industry: 'Software / Open Source', role: `${lang || 'Software'} Engineer (open-source org)`,
        description: d.description || '', sourceUrl: o.html_url, opportunityType: 'Company lead',
        signals: [`Public GitHub org in ${intent.location}${lang ? ` using ${lang}` : ''}`, d.public_repos ? `${d.public_repos} public repos` : null].filter(Boolean),
        updatedAt: d.updated_at, contact: d.email || '',
      });
    });
  },
};

// ---------------- APP: Hacker News "Who is hiring" (Algolia public API) ----------------
const hnHiring = {
  id: 'hn_hiring', name: 'HN “Who is Hiring” threads', app: 'Hacker News (Algolia)', ecosystem: 'Startup / Founder community', weight: 9,
  configured: () => true,
  async search(intent) {
    const since = Math.floor(Date.now() / 1000) - 120 * 86400;
    const q = `${intent.location} ${intent.skills[0] || ''}`.trim();
    const r = await http(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=comment&numericFilters=created_at_i>${since}&hitsPerPage=40`);
    if (!r.ok) throw new Error(`HN Algolia HTTP ${r.status}`);
    return (r.body.hits || [])
      .map((h) => ({ h, text: strip(h.comment_text) }))
      // exclude "Who wants to be hired" candidate posts (Location:/Remote:/Willing to relocate: format)
      .filter(({ text }) => text.includes('|') && !/^(location|seeking|looking)\s*:|willing to relocate\s*:|résumé|resume\s*:/i.test(text) && /(hiring|engineer|developer|onsite|remote)/i.test(text) && text.toLowerCase().includes(intent.location.toLowerCase()))
      .slice(0, 10)
      .map(({ h, text }) => {
        const parts = text.split('|').map((s) => s.trim());
        const url = (h.comment_text.match(/href="([^"]+)"/) || [])[1]?.replace(/&#x2F;/g, '/') || '';
        return lead({
          company: parts[0].slice(0, 60), role: (parts.find((p) => /engineer|developer|scientist|quant/i.test(p)) || 'Engineering roles').slice(0, 80),
          city: intent.location, country: intent.country, industry: 'Startup', description: text.slice(0, 600),
          website: url.startsWith('http') && !url.includes('ycombinator') ? url : '',
          sourceUrl: `https://news.ycombinator.com/item?id=${h.objectID}`, opportunityType: 'Job post (founder thread)',
          signals: ['Posted in HN “Who is hiring” — founder/engineer-written post'], updatedAt: h.created_at,
        });
      });
  },
};

// ---------------- APP: Arbeitnow (European job board public API) ----------------
const arbeitnow = {
  id: 'arbeitnow', name: 'Arbeitnow EU Job Board', app: 'Arbeitnow API', ecosystem: 'Job boards', weight: 3,
  configured: () => true,
  async search(intent) {
    const out = [];
    for (const page of [1, 2]) {
      const r = await http(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
      if (!r.ok) throw new Error(`Arbeitnow HTTP ${r.status}`);
      out.push(...(r.body.data || []));
    }
    const loc = intent.location.toLowerCase();
    return out
      .filter((j) => (j.location || '').toLowerCase().includes(loc) || (j.remote && matchesSkills(`${j.title} ${j.tags}`, intent)))
      .slice(0, 12)
      .map((j) => lead({
        company: j.company_name, role: j.title, city: j.location, country: intent.country, industry: (j.tags || []).slice(0, 2).join(', ') || 'Tech',
        description: strip(j.description).slice(0, 600), sourceUrl: j.url, careersUrl: j.url, opportunityType: j.remote ? 'Remote job' : 'Job',
        signals: ['Active vacancy on job board', j.remote ? 'Remote-friendly' : null].filter(Boolean), updatedAt: new Date(j.created_at * 1000).toISOString(),
      }));
  },
};

// ---------------- APP: Remotive (remote job board public API) ----------------
const remotive = {
  id: 'remotive', name: 'Remotive Remote Jobs', app: 'Remotive API', ecosystem: 'Remote job boards', weight: 3,
  configured: () => true,
  async search(intent) {
    const r = await http(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(intent.skills[0] || 'software')}&limit=25`);
    if (!r.ok) throw new Error(`Remotive HTTP ${r.status}`);
    return (r.body.jobs || [])
      .filter((j) => /worldwide|europe|emea|netherlands|anywhere|global/i.test(j.candidate_required_location || '') || (j.candidate_required_location || '').toLowerCase().includes(intent.country.toLowerCase()))
      .slice(0, 8)
      .map((j) => lead({
        company: j.company_name, role: j.title, city: 'Remote', country: j.candidate_required_location, industry: j.category,
        description: strip(j.description).slice(0, 600), sourceUrl: j.url, careersUrl: j.url, opportunityType: 'Remote job',
        signals: ['Remote vacancy open to ' + j.candidate_required_location], updatedAt: j.publication_date,
      }));
  },
};

// ---------------- APP: Maps — Google Places (key) with OpenStreetMap fallback ----------------
const googlePlaces = {
  id: 'google_maps', name: 'Google Maps / Places', app: 'Google Maps Places API', ecosystem: 'Local business discovery', weight: 7,
  configured: () => !!env('GOOGLE_MAPS_API_KEY'),
  async search(intent) {
    const queries = intent.categories.slice(0, 3).map((c) => `${c} companies ${intent.location}`);
    const all = [];
    for (const textQuery of queries) {
      const r = await http('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env('GOOGLE_MAPS_API_KEY'), 'X-Goog-FieldMask': 'places.displayName,places.websiteUri,places.formattedAddress,places.googleMapsUri,places.primaryTypeDisplayName' },
        body: JSON.stringify({ textQuery, pageSize: 6 }),
      });
      if (!r.ok) throw new Error(`Places HTTP ${r.status}: ${r.body?.error?.message || ''}`);
      all.push(...(r.body.places || []).map((p) => lead({
        company: p.displayName?.text, website: p.websiteUri || '', city: intent.location, country: intent.country,
        industry: p.primaryTypeDisplayName?.text || textQuery, sourceUrl: p.googleMapsUri, opportunityType: 'Company lead',
        description: p.formattedAddress, signals: [`Found on Google Maps for “${textQuery}”`], role: 'Speculative application',
      })));
    }
    return all;
  },
};

const osm = {
  id: 'openstreetmap', name: 'OpenStreetMap Offices', app: 'OpenStreetMap Overpass API', ecosystem: 'Local business discovery', weight: 7,
  configured: () => true,
  async search(intent) {
    const ql = `[out:json][timeout:25];area["name"="${intent.location}"]["boundary"="administrative"]->.a;nwr["office"~"^(it|company|financial|research|telecommunication)$"]["website"](area.a);out center 60;`;
    const r = await http('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(ql), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 });
    if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
    const cats = intent.categories.map((c) => c.toLowerCase());
    return (r.body.elements || [])
      .filter((e) => e.tags?.name)
      .sort((a, b) => (cats.some((c) => (b.tags.name + b.tags.office).toLowerCase().includes(c)) ? 1 : 0) - (cats.some((c) => (a.tags.name + a.tags.office).toLowerCase().includes(c)) ? 1 : 0))
      .slice(0, 12)
      .map((e) => lead({
        company: e.tags.name, website: e.tags.website, city: intent.location, country: intent.country,
        industry: `Office: ${e.tags.office}`, sourceUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`, opportunityType: 'Company lead',
        role: 'Speculative application', description: e.tags.description || '', contact: e.tags.email || e.tags['contact:email'] || '',
        signals: [`Registered ${e.tags.office} office on the map in ${intent.location}`],
      }));
  },
};

// ---------------- APP: Web search (Tavily or Serper, key required) ----------------
// Powers the ecosystem queries: university career fairs, VC portfolios, hackathon sponsors, trading ecosystems.
const webSearch = {
  id: 'web_search', name: 'Web Search (ecosystems)', app: env('TAVILY_API_KEY') ? 'Tavily Search API' : 'Serper (Google Search) API', ecosystem: 'University · VC · Hackathons · Trading', weight: 10,
  configured: () => !!(env('TAVILY_API_KEY') || env('SERPER_API_KEY')),
  async search(intent) {
    const results = [];
    for (const q of intent.ecosystemQueries.slice(0, 7)) {
      let items = [];
      if (env('TAVILY_API_KEY')) {
        const r = await http('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: env('TAVILY_API_KEY'), query: q.query, max_results: 4 }) });
        if (!r.ok) throw new Error(`Tavily HTTP ${r.status}`);
        items = (r.body.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.content }));
      } else {
        const r = await http('https://google.serper.dev/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': env('SERPER_API_KEY') }, body: JSON.stringify({ q: q.query, num: 5 }) });
        if (!r.ok) throw new Error(`Serper HTTP ${r.status}`);
        items = (r.body.organic || []).map((x) => ({ title: x.title, url: x.link, snippet: x.snippet }));
      }
      results.push(...items.map((it) => lead({
        company: it.title.split(/[-|–:]/)[0].trim().slice(0, 60), website: '', city: intent.location, country: intent.country,
        industry: q.ecosystem, sourceUrl: it.url, description: it.snippet, opportunityType: `Ecosystem signal (${q.ecosystem})`,
        role: 'See source', signals: [`Web search: “${q.query}”`], ecosystemHit: q.ecosystem,
      })));
    }
    return results;
  },
};


// ---------------- IMPORTED: freelancer lead spreadsheets (local, git-ignored) ----------------
// Built by `npm run import:leads` → data/private/leads.json. Contact data is the user's own purchased research: verify before outreach.
const COUNTRY_ALIASES = { 'united arab emirates': ['uae', 'dubai', 'abu dhabi'], 'united states': ['usa', 'us', 'new york', 'san francisco'], 'united kingdom': ['uk', 'london'], netherlands: ['amsterdam', 'nl'], india: ['mangalore', 'bangalore', 'bengaluru'], singapore: ['sg'] };
const privateLeads = new URL('../data/private/leads.json', import.meta.url);
const publicLeads = new URL('../data/leads_companies.json', import.meta.url); // company-only, safe to commit
const leadsFile = fs.existsSync(privateLeads) ? privateLeads : publicLeads;
const freelancerLeads = {
  id: 'freelancer_leads', name: 'Freelancer lead reports (Excel)', app: 'Imported spreadsheets', ecosystem: 'Human research', weight: 9,
  configured: () => fs.existsSync(leadsFile),
  async search(intent) {
    const rows = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
    const want = [intent.location, intent.country].filter(Boolean).map((x) => x.toLowerCase());
    for (const [k, v] of Object.entries(COUNTRY_ALIASES)) if (want.some((w) => w === k || v.includes(w))) want.push(k, ...v);
    const clean = (x = '') => x.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').trim();
    const geo = rows.filter((r) => want.some((w) => clean(`${r.country || ''} ${r.city || ''}`).toLowerCase().split(/[\s,/]+/).includes(w) || clean(r.country).toLowerCase() === w));
    const rel = (r) => [...intent.skills, ...intent.categories].filter((k) => `${r.industry} ${r.why} ${r.hiringSignal}`.toLowerCase().includes(k.toLowerCase())).length;
    return geo.sort((a, b) => rel(b) - rel(a) || (Number(b.score) || 0) - (Number(a.score) || 0)).slice(0, 25).map((r) => {
      const site = r.website ? (r.website.startsWith('http') ? r.website : `https://${r.website}`) : '';
      const t = (r.contactTitle || '').toLowerCase();
      return lead({
        company: r.company, website: site, country: clean(r.country), city: clean(r.city || r.country), industry: r.industry || '',
        role: 'Engineering roles (see hiring signal)', description: [r.hiringSignal, r.why].filter(Boolean).join(' — '),
        sourceUrl: site || r.linkedin || '', opportunityType: 'Curated lead', updatedAt: new Date().toISOString(),
        signals: [r.hiringSignal ? `Hiring signal: ${r.hiringSignal}` : null, r.discoverySource ? `Researched via ${r.discoverySource}` : null, r.score ? `Freelancer score ${r.score}` : null].filter(Boolean),
        people: r.contactName ? [{ name: r.contactName, title: r.contactTitle || '', linkedin: r.linkedin || '', email: r.email || '' }] : [],
        founder: /founder|ceo/.test(t) ? r.contactName : '', cto: /cto|technology|engineering/.test(t) ? r.contactName : '', recruiter: /recruit|talent|hr|people/.test(t) ? r.contactName : '',
        contact: r.email || '', leadFiles: r.files,
      });
    });
  },
};

export function matchesSkills(text, intent) {
  const t = (text || '').toLowerCase();
  return intent.skills.some((s) => t.includes(s.toLowerCase()));
}

export const LIVE_SOURCES = [freelancerLeads, webSearch, googlePlaces, osm, github, hnHiring, arbeitnow, remotive];

// Full ecosystem registry shown in the Sources graph. `via` = which live connector covers it today.
export const SOURCE_REGISTRY = [
  ['university_career_fairs', 'University career fairs', 'University', 'web_search'],
  ['university_career_pages', 'University career portals', 'University', 'web_search'],
  ['career_fair_pdfs', 'Career-fair employer PDFs', 'University', 'web_search'],
  ['google_search', 'Google Search', 'Search', 'web_search'],
  ['google_maps', 'Google Maps', 'Maps', 'google_maps'],
  ['openstreetmap', 'OpenStreetMap offices', 'Maps', 'openstreetmap'],
  ['company_career_pages', 'Company career pages', 'Company', 'careers_probe'],
  ['ATS', 'ATS platforms (Greenhouse, Lever, Ashby…)', 'Company', 'careers_probe'],
  ['VC_portfolios', 'VC portfolios', 'Capital', 'web_search'],
  ['accelerators', 'Accelerators', 'Capital', 'web_search'],
  ['hackathons', 'Hackathons', 'Community', 'web_search'],
  ['hackathon_sponsors', 'Hackathon sponsors', 'Community', 'web_search'],
  ['conference_exhibitors', 'Conference exhibitors', 'Events', 'web_search'],
  ['conference_speakers', 'Conference speakers', 'Events', 'web_search'],
  ['trading_ecosystems', 'Trading firms / market makers', 'Trading', 'web_search'],
  ['exchange_ecosystems', 'Exchange members', 'Trading', 'web_search'],
  ['CME_ecosystem', 'CME ecosystem', 'Trading', 'web_search'],
  ['DMCC', 'DMCC public directory', 'Registries', 'web_search'],
  ['Singapore_company_sources', 'Singapore company sources', 'Registries', 'web_search'],
  ['GitHub', 'GitHub organizations', 'Open Source', 'github'],
  ['HN', 'HN Who-is-Hiring', 'Community', 'hn_hiring'],
  ['X', 'X / Twitter hiring posts', 'Social', 'web_search'],
  ['remote_job_boards', 'Remote job boards', 'Job boards', 'remotive'],
  ['EU_job_boards', 'EU job boards', 'Job boards', 'arbeitnow'],
  ['Upwork', 'Upwork', 'Freelance', 'planned'],
  ['Remote_Rocketship', 'Remote Rocketship', 'Job boards', 'planned'],
  ['We_Work_Remotely', 'We Work Remotely', 'Job boards', 'planned'],
  ['freelancer_leads', 'Freelancer lead reports (1,200+ companies)', 'Human research', 'freelancer_leads'],
  ['LinkedIn', 'LinkedIn (human-in-the-loop only)', 'People', 'manual'],
].map(([id, name, group, via]) => ({ id, name, group, via }));
