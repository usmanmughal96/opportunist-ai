import { useEffect, useMemo, useRef, useState } from 'react';

type Opp = {
  id: string; company: string; role: string; city: string; country: string; industry: string; opportunityType: string;
  website?: string; careersUrl?: string; contact?: string; source: string; sources: string[]; sourceUrls: string[];
  signals: string[]; description?: string; score: number; priority: 'HIGH' | 'MEDIUM' | 'LOW'; why: string[];
  breakdown: Record<string, number>; technicalFit: string; visa: string; status: string; demo?: boolean; people?: { name: string; title: string; linkedin: string; email: string }[];
};
type SourceEv = { id: string; name: string; app: string; status: 'running' | 'ok' | 'failed' | 'skipped'; count?: number; ms?: number; detail?: string };
type Health = { apps: { id: string; name: string; app: string; configured: boolean }[]; available: number; total: number; registry: { id: string; name: string; group: string; via: string }[] };
type Mode = 'demo' | 'live';
type Tab = 'overview' | 'console' | 'opportunities' | 'sources' | 'sheets';

const DEFAULT_Q = 'Find Python/C++ opportunities in Amsterdam for someone interested in AI, trading and crypto.';
const BREAKDOWN_MAX: Record<string, number> = { technical: 25, relevance: 20, hiring: 20, international: 10, recent: 10, unconventional: 10, contactability: 5 };

const scoreColor = (p: string) => (p === 'HIGH' ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30' : p === 'MEDIUM' ? 'bg-amber-500/15 text-amber-300 ring-amber-400/30' : 'bg-slate-500/15 text-slate-300 ring-slate-400/30');

export default function App() {
  const [tab, setTab] = useState<Tab>('console');
  const [mode, setMode] = useState<Mode>('demo');
  const [query, setQuery] = useState(DEFAULT_Q);
  const [location, setLocation] = useState('Amsterdam');
  const [country, setCountry] = useState('Netherlands');
  const [skills, setSkills] = useState(['Python', 'C++']);
  const [cats, setCats] = useState(['AI', 'Trading', 'Crypto', 'Fintech']);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [plan, setPlan] = useState<string[]>([]);
  const [sources, setSources] = useState<Record<string, SourceEv>>({});
  const [opps, setOpps] = useState<Opp[]>([]);
  const [resultMode, setResultMode] = useState<Mode | null>(null);
  const [selected, setSelected] = useState<Opp | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [sync, setSync] = useState<{ state: 'idle' | 'busy' | 'ok' | 'csv' | 'error'; msg?: string; url?: string }>({ state: 'idle' });
  const [duration, setDuration] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => { fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => setHealth(null)); }, []);

  function run() {
    esRef.current?.close();
    setRunning(true); setSteps([]); setPlan([]); setSources({}); setOpps([]); setSelected(null); setSync({ state: 'idle' }); setTab('console');
    const p = new URLSearchParams({ q: query, mode, location, country, skills: skills.join(','), categories: cats.join(',') });
    const es = new EventSource(`/api/run?${p}`);
    esRef.current = es;
    es.addEventListener('step', (e) => setSteps((s) => [...s, JSON.parse((e as MessageEvent).data).text]));
    es.addEventListener('plan', (e) => setPlan(JSON.parse((e as MessageEvent).data).queries));
    es.addEventListener('source', (e) => { const d = JSON.parse((e as MessageEvent).data); setSources((s) => ({ ...s, [d.id]: d })); });
    es.addEventListener('result', (e) => {
      const r = JSON.parse((e as MessageEvent).data);
      setOpps(r.opportunities); setResultMode(r.mode); setDuration(r.durationMs); setRunning(false); es.close();
    });
    es.addEventListener('error', (e) => {
      const data = (e as MessageEvent).data;
      setSteps((s) => [...s, data ? `⚠ ${JSON.parse(data).message}` : '⚠ Connection to agent closed']);
      setRunning(false); es.close();
    });
  }

  async function doSync() {
    if (!resultMode) return;
    setSync({ state: 'busy' });
    try {
      const r = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: resultMode }) });
      const b = await r.json();
      if (b.sheets) setSync({ state: 'ok', msg: `✓ ${b.rows} opportunities synced to Google Sheets (${b.updatedRange})`, url: b.url });
      else if (b.error) setSync({ state: 'error', msg: `Google Sheets error: ${b.error}. CSV saved to ${b.csvFile}` });
      else setSync({ state: 'csv', msg: `${b.reason} → ${b.csvFile} (${b.rows} rows)` });
    } catch (e) { setSync({ state: 'error', msg: String(e) }); }
  }

  const srcList = Object.values(sources);
  const stats = useMemo(() => ({
    companies: opps.length, high: opps.filter((o) => o.priority === 'HIGH').length,
    sources: new Set(opps.flatMap((o) => o.sources)).size, countries: new Set(opps.map((o) => o.country).filter(Boolean)).size,
    avg: opps.length ? Math.round(opps.reduce((a, o) => a + o.score, 0) / opps.length) : 0,
    signals: srcList.reduce((a, s) => a + (s.count || 0), 0),
  }), [opps, srcList]);

  const tabs: [Tab, string][] = [['overview', 'Overview'], ['console', 'Agent Console'], ['opportunities', `Opportunities${opps.length ? ` · ${opps.length}` : ''}`], ['sources', 'Source Graph'], ['sheets', 'Google Sheets']];

  return (
    <div className="min-h-screen grid-bg font-sans">
      <header className="border-b border-white/5 bg-black/20 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-emerald-400 grid place-items-center font-black text-black">◎</div>
            <div>
              <div className="font-extrabold tracking-tight text-white leading-none">OpportunityHunter <span className="text-xs font-mono text-violet-300 ml-1">DARKMATTER</span></div>
              <div className="text-[10px] tracking-[0.25em] text-slate-400 mt-1">GLOBAL OPPORTUNITY INTELLIGENCE</div>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1 ml-auto">
            {tabs.map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-sm transition ${tab === t ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}>{label}</button>
            ))}
          </nav>
          <div className="flex items-center rounded-lg bg-white/5 p-0.5 text-xs font-semibold">
            {(['live', 'demo'] as Mode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 rounded-md ${mode === m ? (m === 'live' ? 'bg-emerald-500 text-black' : 'bg-amber-400 text-black') : 'text-slate-400'}`}>{m === 'live' ? '● LIVE' : 'DEMO'}</button>
            ))}
          </div>
        </div>
      </header>

      {resultMode === 'demo' && (
        <div className="bg-amber-400/10 border-b border-amber-400/20 text-amber-200 text-xs text-center py-1.5 font-mono">DEMO DATA — sample dataset for presentation. Switch to LIVE to run real connectors.</div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6">
        {tab === 'overview' && <Overview stats={stats} opps={opps} health={health} resultMode={resultMode} duration={duration} onGo={() => setTab('console')} />}

        {tab === 'console' && (
          <div className="grid lg:grid-cols-5 gap-5">
            <section className="lg:col-span-2 space-y-4">
              <div className="glass rounded-2xl p-5">
                <h1 className="text-2xl font-extrabold text-white tracking-tight">One agent. Hundreds of sources.<br /><span className="bg-gradient-to-r from-indigo-300 to-emerald-300 bg-clip-text text-transparent">Better opportunities.</span></h1>
                <p className="text-sm text-slate-400 mt-2">Don't search job boards. Search the ecosystems that reveal companies.</p>
                <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={3} className="mt-4 w-full rounded-xl bg-black/40 border border-white/10 p-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <Field label="Location" value={location} onChange={setLocation} />
                  <Field label="Country" value={country} onChange={setCountry} />
                </div>
                <Chips label="Categories" all={['Software', 'AI', 'Fintech', 'Quant', 'Trading', 'Crypto', 'Restaurants']} value={cats} onChange={setCats} />
                <Chips label="Skills" all={['Python', 'C++', 'Rust', 'Solana', 'ML', 'TypeScript']} value={skills} onChange={setSkills} />
                <button onClick={run} disabled={running} className="mt-4 w-full rounded-xl py-3 font-bold text-black bg-gradient-to-r from-indigo-400 via-violet-400 to-emerald-300 hover:brightness-110 disabled:opacity-60 transition">
                  {running ? 'Agent hunting…' : `Hunt opportunities (${mode.toUpperCase()})`}
                </button>
              </div>
              <HealthCard health={health} />
            </section>

            <section className="lg:col-span-3 glass rounded-2xl p-5 min-h-[520px]">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-widest text-slate-400">AGENT TRACE</h2>
                {running && <span className="text-xs text-violet-300 animate-pulse font-mono">● streaming</span>}
              </div>
              {!steps.length && !running && <p className="text-slate-500 text-sm mt-10 text-center">Run the agent to see its plan, sources and scoring in real time.</p>}
              {steps.length > 0 && (
                <div className="mt-4 space-y-3 font-mono text-sm">
                  <div className="fade-up"><span className="text-slate-500">You:</span> <span className="text-white">{query}</span></div>
                  {plan.length > 0 && (
                    <div className="fade-up rounded-xl bg-black/30 p-3 border border-white/5">
                      <div className="text-violet-300 text-xs mb-2">SEARCH PLAN · {plan.length} queries</div>
                      <div className="flex flex-wrap gap-1.5">{plan.map((q) => <span key={q} className="text-[11px] px-2 py-0.5 rounded bg-white/5 text-slate-300">{q}</span>)}</div>
                    </div>
                  )}
                  {srcList.length > 0 && (
                    <div className="grid sm:grid-cols-2 gap-2">
                      {srcList.map((s) => (
                        <div key={s.id} className="fade-up rounded-xl bg-black/30 border border-white/5 p-2.5 flex items-start gap-2">
                          <span className={`mt-0.5 ${s.status === 'ok' ? 'text-emerald-400' : s.status === 'failed' ? 'text-rose-400' : s.status === 'skipped' ? 'text-slate-500' : 'text-violet-300 animate-pulse'}`}>{s.status === 'ok' ? '✓' : s.status === 'failed' ? '✕' : s.status === 'skipped' ? '○' : '◌'}</span>
                          <div className="min-w-0">
                            <div className="text-white text-xs truncate">{s.name}</div>
                            <div className="text-[10px] text-slate-500 truncate">{s.app}{s.status === 'ok' ? ` · ${s.count} signals · ${s.ms}ms` : s.detail ? ` · ${s.detail}` : ''}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {srcList.some((s) => s.status === 'failed' || s.status === 'skipped') && !running && (
                    <div className="text-xs text-amber-300/90">Degraded gracefully — continued with: {srcList.filter((s) => s.status === 'ok').map((s) => s.name).join(', ') || 'no sources'}</div>
                  )}
                  {steps.map((s, i) => <div key={i} className="fade-up text-slate-300"><span className="text-emerald-400">›</span> {s}</div>)}
                  {!running && opps.length > 0 && (
                    <div className="fade-up pt-2">
                      <div className="text-xs text-slate-400 mb-2">TOP OPPORTUNITIES · {(duration / 1000).toFixed(1)}s</div>
                      <div className="space-y-2">{opps.slice(0, 5).map((o) => <OppRow key={o.id} o={o} onClick={() => setSelected(o)} />)}</div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => setTab('opportunities')} className="text-xs px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15">View all {opps.length} →</button>
                        <button onClick={() => { setTab('sheets'); doSync(); }} className="text-xs px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30">Sync to Google Sheets</button>
                      </div>
                    </div>
                  )}
                  {!running && resultMode && opps.length === 0 && <div className="text-amber-300 text-xs">No opportunities returned by live sources for this query. Try another location or DEMO mode.</div>}
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'opportunities' && (
          <div className="glass rounded-2xl overflow-hidden">
            {!opps.length ? <Empty onGo={() => setTab('console')} /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] tracking-wider text-slate-400 bg-black/30">
                    <tr>{['Company', 'Role', 'Location', 'Match', 'Source', 'Why', 'Status'].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {opps.map((o) => (
                      <tr key={o.id} onClick={() => setSelected(o)} className="border-t border-white/5 hover:bg-white/5 cursor-pointer">
                        <td className="px-4 py-3"><div className="font-semibold text-white">{o.company}</div><div className="text-[11px] text-slate-500">{o.industry}</div></td>
                        <td className="px-4 py-3 text-slate-300 max-w-56">{o.role}</td>
                        <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{o.city}</td>
                        <td className="px-4 py-3"><Score o={o} /></td>
                        <td className="px-4 py-3 text-xs text-violet-300 max-w-44">{o.sources.join(' + ')}</td>
                        <td className="px-4 py-3 text-xs text-slate-400 max-w-72">{o.why[0]}</td>
                        <td className="px-4 py-3"><span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300">{o.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'sources' && <SourceGraph health={health} sources={sources} />}

        {tab === 'sheets' && (
          <div className="glass rounded-2xl p-6 max-w-2xl">
            <h2 className="text-xl font-bold text-white">Google Sheets — operational database</h2>
            <p className="text-sm text-slate-400 mt-1">Appends every qualified opportunity (21 columns: company, careers URL, source URL, score, why, visa, status…). A CSV copy is always written to <code className="font-mono text-xs">data/private/</code>.</p>
            <div className="mt-4 text-sm">Status: {health?.apps.find((a) => a.id === 'google_sheets')?.configured ? <span className="text-emerald-300">Connected (service account)</span> : <span className="text-amber-300">Not connected — set GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_FILE in .env (CSV fallback active)</span>}</div>
            <div className="flex gap-2 mt-5">
              <button onClick={doSync} disabled={!opps.length || sync.state === 'busy'} className="px-5 py-3 rounded-xl font-bold bg-emerald-400 text-black disabled:opacity-40">{sync.state === 'busy' ? 'Syncing…' : 'SYNC TO GOOGLE SHEETS'}</button>
              {resultMode && <a href={`/api/export.csv?mode=${resultMode}`} className="px-5 py-3 rounded-xl font-semibold bg-white/10">Download CSV</a>}
            </div>
            {!opps.length && <p className="text-xs text-slate-500 mt-3">Run the agent first.</p>}
            {sync.msg && (
              <div className={`mt-4 rounded-xl p-3 text-sm ${sync.state === 'ok' ? 'bg-emerald-500/10 text-emerald-200' : sync.state === 'csv' ? 'bg-amber-500/10 text-amber-200' : 'bg-rose-500/10 text-rose-200'}`}>
                {sync.msg} {sync.url && <a href={sync.url} target="_blank" className="underline ml-1">Open sheet ↗</a>}
              </div>
            )}
          </div>
        )}
      </main>

      {selected && <CompanyPanel o={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-[10px] tracking-wider text-slate-500">{label.toUpperCase()}
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-2.5 py-1.5 text-sm text-white" />
    </label>
  );
}

function Chips({ label, all, value, onChange }: { label: string; all: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="mt-3">
      <div className="text-[10px] tracking-wider text-slate-500 mb-1">{label.toUpperCase()}</div>
      <div className="flex flex-wrap gap-1.5">
        {all.map((c) => {
          const on = value.includes(c);
          return <button key={c} onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])} className={`text-xs px-2.5 py-1 rounded-full ring-1 transition ${on ? 'bg-violet-500/20 ring-violet-400/50 text-violet-200' : 'ring-white/10 text-slate-400 hover:text-white'}`}>{c}</button>;
        })}
      </div>
    </div>
  );
}

function Score({ o }: { o: Opp }) {
  return <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md ring-1 font-mono text-xs ${scoreColor(o.priority)}`}><b>{o.score}</b>{o.priority}</span>;
}

function OppRow({ o, onClick }: { o: Opp; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left rounded-xl bg-black/30 border border-white/5 hover:border-violet-400/40 p-3 flex items-center gap-3 transition">
      <Score o={o} />
      <div className="min-w-0 flex-1">
        <div className="text-white text-sm font-sans font-semibold truncate">{o.company} <span className="text-slate-400 font-normal">· {o.role}</span></div>
        <div className="text-[11px] text-slate-500 truncate">{o.why.slice(0, 2).join(' • ')}</div>
      </div>
      <span className="text-[10px] text-violet-300 hidden sm:block truncate max-w-36">{o.sources[0]}</span>
    </button>
  );
}

function HealthCard({ health }: { health: Health | null }) {
  if (!health) return <div className="glass rounded-2xl p-4 text-sm text-rose-300">API offline — start the server with <code>npm start</code></div>;
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex justify-between text-xs tracking-widest text-slate-400"><span>HEALTH</span><span className="text-emerald-300">{health.available}/{health.total} apps available</span></div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3">
        {health.apps.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-xs"><span className={`h-1.5 w-1.5 rounded-full ${a.configured ? 'bg-emerald-400' : 'bg-slate-600'}`} /><span className={a.configured ? 'text-slate-200' : 'text-slate-500'}>{a.app}</span></div>
        ))}
      </div>
    </div>
  );
}

function Overview({ stats, opps, health, resultMode, duration, onGo }: { stats: any; opps: Opp[]; health: Health | null; resultMode: Mode | null; duration: number; onGo: () => void }) {
  const cards = [['Companies discovered', stats.companies], ['Raw signals', stats.signals], ['High-value', stats.high], ['Sources hit', stats.sources], ['Countries', stats.countries], ['Avg match', `${stats.avg}%`]];
  const buckets = [['90+', 90, 101], ['75–89', 75, 90], ['55–74', 55, 75], ['<55', 0, 55]].map(([l, a, b]) => [l, opps.filter((o) => o.score >= (a as number) && o.score < (b as number)).length] as [string, number]);
  const bySource = Object.entries(opps.reduce((m: Record<string, number>, o) => { o.sources.forEach((s) => (m[s] = (m[s] || 0) + 1)); return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1, ...bySource.map((b) => b[1]), ...buckets.map((b) => b[1]));
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs tracking-[0.3em] text-violet-300">GLOBAL OPPORTUNITY INTELLIGENCE</div>
          <h1 className="text-3xl font-extrabold text-white mt-1">One agent. Hundreds of sources. Better opportunities.</h1>
        </div>
        {resultMode && <span className={`text-xs font-mono px-2 py-1 rounded ${resultMode === 'demo' ? 'bg-amber-400/15 text-amber-300' : 'bg-emerald-400/15 text-emerald-300'}`}>{resultMode === 'demo' ? 'DEMO DATA' : 'LIVE RUN'} · {(duration / 1000).toFixed(1)}s</span>}
      </div>
      {!opps.length ? <Empty onGo={onGo} /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {cards.map(([l, v]) => <div key={l} className="glass rounded-2xl p-4"><div className="text-3xl font-extrabold text-white">{v}</div><div className="text-[11px] text-slate-400 mt-1">{l}</div></div>)}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Bars title="Opportunities by source ecosystem" rows={bySource} max={max} color="from-violet-500 to-indigo-400" />
            <Bars title="Match score distribution" rows={buckets} max={max} color="from-emerald-500 to-teal-300" />
          </div>
        </>
      )}
      <HealthCard health={health} />
    </div>
  );
}

function Bars({ title, rows, max, color }: { title: string; rows: [string, number][]; max: number; color: string }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="text-xs tracking-widest text-slate-400 mb-4">{title.toUpperCase()}</div>
      <div className="space-y-2.5">
        {rows.map(([l, v]) => (
          <div key={l} className="flex items-center gap-3 text-xs">
            <div className="w-40 truncate text-slate-300">{l}</div>
            <div className="flex-1 h-2.5 rounded-full bg-white/5 overflow-hidden"><div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-700`} style={{ width: `${(v / max) * 100}%` }} /></div>
            <div className="w-6 text-right font-mono text-slate-400">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty({ onGo }: { onGo: () => void }) {
  return <div className="glass rounded-2xl p-10 text-center text-slate-400">No run yet. <button onClick={onGo} className="text-violet-300 underline">Open the Agent Console →</button></div>;
}

function SourceGraph({ health, sources }: { health: Health | null; sources: Record<string, SourceEv> }) {
  const reg = health?.registry || [];
  const groups = [...new Set(reg.map((r) => r.group))];
  const live = new Set(health?.apps.filter((a) => a.configured).map((a) => a.id));
  const H = Math.max(420, groups.length * 44);
  return (
    <div className="glass rounded-2xl p-5">
      <div className="text-xs tracking-widest text-slate-400">SOURCE ECOSYSTEM GRAPH · {reg.length} registered sources</div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 900 ${H}`} className="w-full min-w-[720px] mt-3">
          <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stopColor="#818cf8" /><stop offset="1" stopColor="#34d399" /></linearGradient></defs>
          {groups.map((g, i) => {
            const y = 30 + i * ((H - 60) / Math.max(1, groups.length - 1));
            const items = reg.filter((r) => r.group === g);
            const active = items.some((r) => live.has(r.via) || r.via === 'careers_probe' || sources[r.via]?.status === 'ok');
            return (
              <g key={g}>
                <path d={`M 250 ${y} C 400 ${y}, 420 ${H / 2}, 560 ${H / 2}`} fill="none" stroke={active ? 'url(#g)' : '#334155'} strokeWidth={active ? 1.8 : 1} className={active ? 'flow' : ''} />
                <rect x="10" y={y - 16} width="240" height="32" rx="10" fill={active ? 'rgba(99,102,241,.15)' : 'rgba(51,65,85,.25)'} stroke={active ? 'rgba(129,140,248,.5)' : 'rgba(71,85,105,.5)'} />
                <text x="24" y={y - 1} fill="#fff" fontSize="12" fontWeight="600">{g}</text>
                <text x="24" y={y + 11} fill="#94a3b8" fontSize="9">{items.map((r) => r.name).join(' · ').slice(0, 44)}</text>
              </g>
            );
          })}
          <rect x="560" y={H / 2 - 34} width="150" height="68" rx="16" fill="rgba(139,92,246,.2)" stroke="#a78bfa" />
          <text x="635" y={H / 2 - 4} textAnchor="middle" fill="#fff" fontSize="14" fontWeight="800">AI AGENT</text>
          <text x="635" y={H / 2 + 14} textAnchor="middle" fill="#c4b5fd" fontSize="10">plan · dedup · score</text>
          <path d={`M 710 ${H / 2} L 760 ${H / 2}`} stroke="url(#g)" strokeWidth="2" className="flow" />
          <rect x="760" y={H / 2 - 30} width="130" height="60" rx="14" fill="rgba(16,185,129,.18)" stroke="#34d399" />
          <text x="825" y={H / 2 + 5} textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700">OPPORTUNITIES</text>
        </svg>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-4">
        {reg.map((r) => {
          const st = live.has(r.via) || r.via === 'careers_probe' ? 'live' : r.via === 'planned' ? 'planned' : r.via === 'manual' ? 'human-in-loop' : 'needs key';
          return <div key={r.id} className="text-xs rounded-lg bg-black/30 px-3 py-2 flex justify-between gap-2"><span className="text-slate-300 truncate">{r.name}</span><span className={st === 'live' ? 'text-emerald-400' : 'text-slate-500'}>{st}</span></div>;
        })}
      </div>
      <p className="text-[11px] text-slate-500 mt-3">“live” = connector works with current credentials. “needs key” = routed through Web Search (Tavily/Serper) once a key is set. Nothing is reported as searched unless its connector actually ran.</p>
    </div>
  );
}

function CompanyPanel({ o, onClose }: { o: Opp; onClose: () => void }) {
  const people = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${o.company} CTO OR founder OR "engineering manager" OR recruiter`)}`;
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/60" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className="fade-up w-full max-w-lg h-full overflow-y-auto bg-[#0a0e1a] border-l border-white/10 p-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-[10px] tracking-[0.25em] text-violet-300">COMPANY INTELLIGENCE {o.demo && <span className="text-amber-300">· DEMO DATA</span>}</div>
            <h2 className="text-2xl font-extrabold text-white mt-1">{o.company}</h2>
            <div className="text-sm text-slate-400">{o.industry} · {o.city}{o.country ? `, ${o.country}` : ''}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="mt-5 flex items-center gap-4 rounded-2xl bg-white/5 p-4">
          <div className={`text-4xl font-black ${o.priority === 'HIGH' ? 'text-emerald-300' : o.priority === 'MEDIUM' ? 'text-amber-300' : 'text-slate-300'}`}>{o.score}<span className="text-base text-slate-500">/100</span></div>
          <div className="text-sm"><div className="text-white font-semibold">{o.role}</div><div className="text-slate-400 text-xs">{o.opportunityType}</div></div>
        </div>
        <Section title="WHY">{o.why.map((w) => <li key={w}>• {w}</li>)}</Section>
        <Section title="SCORE BREAKDOWN">
          {Object.entries(o.breakdown).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-xs"><span className="w-28 capitalize text-slate-400">{k}</span><div className="flex-1 h-1.5 bg-white/5 rounded"><div className="h-full rounded bg-violet-400" style={{ width: `${(v / BREAKDOWN_MAX[k]) * 100}%` }} /></div><span className="font-mono w-10 text-right">{v}/{BREAKDOWN_MAX[k]}</span></div>
          ))}
        </Section>
        <Section title="WHY WE FOUND IT">{o.sources.map((s) => <li key={s} className="text-violet-200">◆ {s}</li>)}{o.sourceUrls.filter(Boolean).slice(0, 4).map((u) => <li key={u}><a href={u} target="_blank" className="text-xs text-sky-300 underline break-all">{u}</a></li>)}</Section>
        <Section title="HIRING SIGNALS">{o.signals.map((s) => <li key={s} className="text-emerald-200">✓ {s}</li>)}</Section>
        <Section title="LINKS">
          {o.website && <li><a className="text-sky-300 underline" href={o.website} target="_blank">Website ↗</a></li>}
          {o.careersUrl && <li><a className="text-sky-300 underline break-all" href={o.careersUrl} target="_blank">Careers ↗</a></li>}
          {o.contact && <li className="text-slate-300">Public contact: {o.contact}</li>}
          <li className="text-slate-400">Technical fit: {o.technicalFit} · Visa: {o.visa}</li>
        </Section>
        {!!o.people?.length && (
          <Section title="PEOPLE (from freelancer lead reports — verify before outreach)">
            {o.people.map((p) => <li key={p.name + p.title} className="text-xs"><b className="text-white">{p.name}</b> · {p.title} {p.linkedin && <a className="text-sky-300 underline ml-1" href={p.linkedin} target="_blank">LinkedIn ↗</a>} {p.email && <span className="text-slate-400 ml-1">{p.email}</span>}</li>)}
          </Section>
        )}
        <Section title="PEOPLE (human-in-the-loop)">
          <p className="text-xs text-slate-400">Founder / CTO / Engineering lead are not auto-extracted. Open a public search and verify manually — no scraping of private data.</p>
          <a href={people} target="_blank" className="inline-block mt-2 text-xs px-3 py-2 rounded-lg bg-sky-500/15 text-sky-200">Open LinkedIn people search ↗</a>
        </Section>
        {o.description && <Section title="SOURCE EXCERPT"><p className="text-xs text-slate-400 leading-relaxed">{o.description}</p></Section>}
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mt-5"><div className="text-[10px] tracking-[0.25em] text-slate-500 mb-2">{title}</div><ul className="space-y-1.5 text-sm text-slate-200">{children}</ul></div>;
}
