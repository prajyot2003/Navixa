// Navixa — job-search intelligence:
//   • saved searches with "new since you last looked" counts
//   • near-duplicate collapsing (same role cross-posted with slightly different titles)
//   • salary parsing + aggregation into ranges
import { getState, update } from './store.js';

/* ================= Saved searches ================= */
// Stored as s.jobs.searches = [{ id, name, q, type, source, remoteOnly, sort, seen:{id:true}, lastRun }]

const store = () => getState().jobs.searches || [];

export function savedSearches() { return store(); }

export function saveSearch({ name, q, type, source, remoteOnly, sort }) {
  const id = 's' + Date.now().toString(36);
  update((s) => {
    s.jobs.searches = s.jobs.searches || [];
    s.jobs.searches.unshift({ id, name: name || q || 'Untitled search', q, type, source, remoteOnly, sort, seen: {}, lastRun: 0 });
    s.jobs.searches = s.jobs.searches.slice(0, 12);
  }, { type: 'jobs' });
  return id;
}

export function deleteSearch(id) {
  update((s) => { s.jobs.searches = (s.jobs.searches || []).filter((x) => x.id !== id); }, { type: 'jobs' });
}

/** Which of these results has the user not seen yet for this saved search? */
export function unseenFor(id, jobs) {
  const sch = store().find((x) => x.id === id);
  if (!sch) return [];
  return jobs.filter((j) => !sch.seen?.[j.id]);
}

/** Mark every currently-visible result as seen. */
export function markSeen(id, jobs) {
  update((s) => {
    const sch = (s.jobs.searches || []).find((x) => x.id === id);
    if (!sch) return;
    sch.seen = sch.seen || {};
    for (const j of jobs) sch.seen[j.id] = 1;
    // keep the seen map from growing without bound
    const keys = Object.keys(sch.seen);
    if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete sch.seen[k];
    sch.lastRun = Date.now();
  }, { type: 'jobs' });
}

/* ================= Near-duplicate collapsing ================= */
// api.js already drops exact title+company repeats. This catches the messier
// cases: "Senior React Developer (Remote)" vs "Senior React Developer - Remote"
// posted by the same company on two different boards.

const NOISE = /\b(remote|hybrid|onsite|on-site|urgent|hiring|now|immediate|contract|full[- ]?time|part[- ]?time|permanent|w2|c2c|m\/f\/d|m\/w\/d|h\/f)\b/g;

export function normTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')          // drop parenthetical asides
    .replace(/[–—-]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/[^a-z0-9+#. ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const normCompany = (c) => String(c || '')
  .toLowerCase()
  .replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|plc|pvt|private)\b\.?/g, ' ')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// token-overlap similarity (Jaccard) — cheap and good enough for titles
function similar(a, b) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / (A.size + B.size - hit);
}

/**
 * Collapse near-duplicates. Keeps the richest listing (longest description,
 * preferring one with a salary) and attaches `.alsoOn` = [source, …].
 */
export function collapseDuplicates(jobs, { threshold = 0.8 } = {}) {
  const byCompany = new Map();
  for (const j of jobs) {
    const key = normCompany(j.company) || '~';
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(j);
  }

  const out = [];
  for (const list of byCompany.values()) {
    const groups = [];
    for (const j of list) {
      const nt = normTitle(j.title);
      const g = groups.find((grp) => similar(grp.nt, nt) >= threshold);
      if (g) g.items.push(j);
      else groups.push({ nt, items: [j] });
    }
    for (const g of groups) {
      if (g.items.length === 1) { out.push(g.items[0]); continue; }
      const best = g.items.slice().sort((a, b) =>
        (b.salary ? 1 : 0) - (a.salary ? 1 : 0)
        || String(b.description || '').length - String(a.description || '').length)[0];
      const others = [...new Set(g.items.filter((x) => x !== best).map((x) => x.source).filter(Boolean))];
      out.push(others.length ? { ...best, alsoOn: others } : best);
    }
  }
  // preserve the original ordering
  const rank = new Map(jobs.map((j, i) => [j.id, i]));
  return out.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

/* ================= Salary parsing ================= */

const CUR = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR', '¥': 'JPY' };
// rough annualisation multipliers
const PERIOD = [
  [/\b(per\s+hour|hourly|\/\s*hr|\/\s*hour|an hour)\b/i, 2080],
  [/\b(per\s+day|daily|\/\s*day|a day)\b/i, 240],
  [/\b(per\s+week|weekly|\/\s*wk|\/\s*week)\b/i, 52],
  [/\b(per\s+month|monthly|\/\s*mo|\/\s*month|a month|pm)\b/i, 12],
];

function toNumber(raw) {
  let s = String(raw).replace(/[, ]/g, '');
  let mult = 1;
  if (/k$/i.test(s)) { mult = 1000; s = s.slice(0, -1); }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n * mult : null;
}

/**
 * Parse a free-text salary string into { min, max, currency, period, annualMin, annualMax }.
 * Returns null when there's nothing usable — never guesses.
 */
export function parseSalary(text) {
  if (!text) return null;
  const s = String(text);
  if (/\b(competitive|doe|negotiable|depending on experience|unpaid)\b/i.test(s) && !/\d/.test(s)) return null;

  const symbol = Object.keys(CUR).find((c) => s.includes(c));
  const code = (s.match(/\b(USD|EUR|GBP|INR|CAD|AUD|SGD|CHF|SEK|JPY)\b/i) || [])[1];
  const currency = (code && code.toUpperCase()) || (symbol && CUR[symbol]) || '';

  // Work out the pay period first — it decides which magnitudes are plausible.
  let mult = 1, period = 'year';
  for (const [re, m] of PERIOD) {
    if (re.test(s)) { mult = m; period = m === 2080 ? 'hour' : m === 240 ? 'day' : m === 52 ? 'week' : 'month'; break; }
  }

  // "401k" is a benefit, not pay — drop it before reading numbers.
  const cleaned = s.replace(/\b401\s*\(?k\)?\b/gi, ' ');
  const floor = period === 'hour' ? 5 : period === 'day' ? 20 : period === 'week' ? 50 : 100;
  const nums = (cleaned.match(/\d[\d,. ]*\s*k?\b/gi) || [])
    .map((x) => toNumber(x.trim()))
    .filter((n) => n != null && n >= floor);
  if (!nums.length) return null;

  // a bare number under 1000 with no stated period is almost certainly hourly
  if (mult === 1 && Math.max(...nums) < 1000) { mult = 2080; period = 'hour'; }

  const min = Math.min(...nums), max = Math.max(...nums);
  return {
    min, max, currency, period,
    annualMin: Math.round(min * mult),
    annualMax: Math.round(max * mult),
  };
}

const fmt = (n, currency) => {
  const sym = Object.entries(CUR).find(([, c]) => c === currency)?.[0] || '';
  const v = n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
  return sym ? `${sym}${v}` : `${v}${currency ? ' ' + currency : ''}`;
};

/**
 * Aggregate salary data across listings.
 * Returns null when too few postings disclose pay to say anything honest.
 */
export function salaryInsights(jobs, { min = 3 } = {}) {
  const parsed = jobs
    .map((j) => ({ job: j, sal: parseSalary(j.salary) }))
    .filter((x) => x.sal && x.sal.annualMax > 0);
  if (parsed.length < min) return null;

  // Use the dominant currency so we never average across currencies.
  const counts = {};
  for (const p of parsed) counts[p.sal.currency || '?'] = (counts[p.sal.currency || '?'] || 0) + 1;
  const currency = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const set = parsed.filter((p) => (p.sal.currency || '?') === currency);
  if (set.length < min) return null;

  const mids = set.map((p) => (p.sal.annualMin + p.sal.annualMax) / 2).sort((a, b) => a - b);
  const at = (q) => mids[Math.min(mids.length - 1, Math.floor(q * (mids.length - 1)))];

  return {
    count: set.length,
    disclosed: Math.round((parsed.length / jobs.length) * 100),
    currency: currency === '?' ? '' : currency,
    low: at(0.1), median: at(0.5), high: at(0.9),
    text: `${fmt(at(0.1), currency)} – ${fmt(at(0.9), currency)}`,
    medianText: fmt(at(0.5), currency),
  };
}
