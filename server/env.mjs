// Minimal .env loader (no dependencies). Real env vars take precedence.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const env = (k) => (process.env[k] || '').trim();

/** fetch with timeout + JSON/text helpers. Never throws on HTTP status; throws on network/timeout. */
export async function http(url, { timeout = 12000, json = true, ...opts } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'User-Agent': 'OpportunityHunter/1.0 (hackathon research agent)', ...(opts.headers || {}) },
    });
    const body = json ? await res.json().catch(() => null) : await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, body, url: res.url };
  } finally {
    clearTimeout(t);
  }
}
