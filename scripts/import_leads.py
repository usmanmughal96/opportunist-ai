r"""Import freelancer lead spreadsheets into data/private/leads.json (git-ignored).

Usage: python scripts/import_leads.py "E:\companies career leads\leads sent by freelancer"
Finds the header row (a row containing a 'Company' cell) on every sheet, normalizes columns, dedupes by company+website.
"""
import sys, glob, json, os, re
import pandas as pd

SRC = sys.argv[1] if len(sys.argv) > 1 else r"E:\companies career leads\leads sent by freelancer"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "private", "leads.json")

ALIASES = {
    "company": ["company name", "company", "organisation", "organization", "firm"],
    "country": ["country", "hq country"], "city": ["city", "location", "hq", "headquarters"],
    "website": ["website", "url", "domain", "company website"], "industry": ["industry", "sector", "category", "vertical"],
    "contactName": ["contact name", "name", "decision maker", "founder", "contact"], "contactTitle": ["contact title", "title", "role", "position", "designation"],
    "linkedin": ["linkedin url", "linkedin", "linkedin profile"], "email": ["email address", "email", "work email"],
    "hiringSignal": ["hiring signal", "signal", "open roles", "hiring"], "discoverySource": ["source of discovery", "source", "discovered via"],
    "why": ["why this fits the candidate", "why", "fit", "rationale", "notes"], "score": ["score", "lead score", "quality score", "fit score"],
    "size": ["company size", "size", "employees", "headcount"], "careersUrl": ["careers url", "careers page", "jobs page"],
}

def canon(col):
    c = re.sub(r"\s+", " ", str(col).strip().lower())
    for key, names in ALIASES.items():
        if c in names: return key
    for key, names in ALIASES.items():
        if any(n in c for n in names if len(n) > 4): return key
    return None

leads, stats = {}, []
for f in sorted(glob.glob(os.path.join(SRC, "*.xlsx"))):
    for sheet, raw in pd.read_excel(f, sheet_name=None, header=None, dtype=str).items():
        hdr = next((i for i in range(min(15, len(raw))) if any(str(v).strip().lower() in ("company name", "company") for v in raw.iloc[i])), None)
        if hdr is None: continue
        df = raw.iloc[hdr + 1:].copy(); df.columns = [str(c) for c in raw.iloc[hdr]]
        mapping = {}
        for col in df.columns:
            k = canon(col)
            if k and k not in mapping.values(): mapping[col] = k
        n = 0
        for _, r in df.iterrows():
            rec = {k: str(r[c]).strip() for c, k in mapping.items() if pd.notna(r[c]) and str(r[c]).strip() not in ("", "nan", "-", "N/A")}
            if not rec.get("company") or rec["company"].isdigit(): continue
            key = re.sub(r"[^a-z0-9]", "", rec["company"].lower()) + "|" + re.sub(r"^https?://(www\.)?|/.*$", "", rec.get("website", "").lower())
            prev = leads.get(key, {"files": []})
            merged = {**rec, **{k: v for k, v in prev.items() if v and k != "files"}}
            merged["files"] = sorted(set(prev["files"] + [f"{os.path.basename(f)} › {sheet}"]))
            leads[key] = merged; n += 1
        stats.append((os.path.basename(f), sheet, n, sorted(set(mapping.values()))))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh: json.dump(list(leads.values()), fh, ensure_ascii=False, indent=1)
for s in stats: print(f"{s[0]} | {s[1]} | {s[2]} rows | fields: {', '.join(s[3])}")
print(f"TOTAL unique leads: {len(leads)} -> {os.path.relpath(OUT)}")
