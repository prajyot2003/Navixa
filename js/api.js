// Navixa — external data: LLM chat, jobs, articles, videos
import { LLM, ENDPOINTS, VIDEO_FALLBACK_INSTANCES, getCourses, getDefaultModel } from './config.js';
import { getState } from './store.js';
import { stripHtml } from './utils.js';

const isHttp = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);

async function fetchJson(url, opts = {}, timeout = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

// Try direct, then same-origin proxy (works after deploy; avoids CORS/bot walls)
async function fetchJsonSmart(url, timeout = 12000) {
  try { return await fetchJson(url, {}, timeout); }
  catch (e) {
    if (!isHttp) throw e;
    return await fetchJson(ENDPOINTS.proxy(url), {}, timeout + 4000);
  }
}

/* ================= LLM ================= */

export function llmConfig() {
  const s = getState();
  const custom = s?.settings.llm;
  if (custom?.mode === 'custom' && custom.baseUrl) {
    return { base: custom.baseUrl.replace(/\/+$/, ''), key: custom.apiKey || '', model: custom.model || 'gpt-4o-mini', label: 'Custom' };
  }
  const p = LLM.providers[0];
  return { base: p.base, key: p.key, model: (custom?.model && custom.mode === 'auto' ? custom.model : '') || getDefaultModel(), label: p.label };
}

// Free gateways drop models without notice — keep a candidate list and remember what worked.
const MODEL_OK_KEY = 'navixa:llm-model-ok';
function modelCandidates(cfg, override) {
  if (override) return [override];
  if (cfg.label === 'Custom') return [cfg.model]; // respect an explicit custom provider/model
  let cached = '';
  try { cached = localStorage.getItem(MODEL_OK_KEY) || ''; } catch {}
  return [...new Set([cached, cfg.model, ...LLM.providers[0].models].filter(Boolean))];
}

// messages: [{role, content}] — onDelta(textChunk) streams; resolves full text.
export async function llmChat(messages, { onDelta, model, temperature = LLM.temperature, signal } = {}) {
  const cfg = llmConfig();
  const endpoints = [
    { url: `${cfg.base}/chat/completions`, headers: auth(cfg.key) },
    ...(isHttp ? [{ url: LLM.proxyEndpoint, headers: {} }] : []),
  ];
  const models = modelCandidates(cfg, model);
  let lastErr;
  for (const m of models) {
    for (const a of endpoints) {
      try {
        const body = { model: m, messages: messages.slice(-LLM.maxHistory * 2), temperature, stream: !!onDelta };
        const res = await fetch(a.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...a.headers },
          body: JSON.stringify(body),
          signal,
        });
        if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
        const ct = res.headers.get('content-type') || '';
        let text;
        if (body.stream && ct.includes('text/event-stream') && res.body) {
          text = await readSse(res, onDelta);
        } else {
          const data = await res.json();
          text = data?.choices?.[0]?.message?.content ?? data?.content ?? '';
          if (!text) throw new Error('Empty LLM response');
          onDelta?.(text);
        }
        try { localStorage.setItem(MODEL_OK_KEY, m); } catch {}
        return text;
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        lastErr = e;
        if (/HTTP 4\d\d/.test(e.message || '')) break; // model rejected upstream → try next model
      }
    }
  }
  throw lastErr || new Error('LLM unavailable');
}

function auth(key) { return key ? { Authorization: `Bearer ${key}` } : {}; }

async function readSse(res, onDelta) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const m = line.match(/^data:\s*(.*)$/);
      if (!m) continue;
      const payload = m[1].trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const delta = j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.message?.content ?? '';
        if (delta) { full += delta; onDelta?.(delta); }
      } catch { /* partial line */ }
    }
  }
  if (!full) throw new Error('Empty stream');
  return full;
}

export async function llmPing() {
  const t0 = performance.now();
  const text = await llmChat([{ role: 'user', content: 'Reply with exactly: pong' }], { temperature: 0 });
  return { ok: /pong/i.test(text), ms: Math.round(performance.now() - t0), text: text.slice(0, 60) };
}

export function systemPrompt(mode = 'copilot') {
  const s = getState();
  const p = s?.profile || {};
  const who = [
    p.role ? `They are a ${p.role}.` : '',
    p.targetRole ? `Target role: ${p.targetRole}.` : '',
    p.skills?.length ? `Skills: ${p.skills.join(', ')}.` : '',
    p.interests?.length ? `Interests: ${p.interests.join(', ')}.` : '',
    p.location ? `Location: ${p.location}.` : '',
  ].filter(Boolean).join(' ');
  const base = `You are Navixa, a sharp, encouraging career advisor inside a career-navigation app. Today is ${new Date().toDateString()}. ${who ? `About the user: ${who}` : ''} Be practical and specific. Use short paragraphs and markdown lists when helpful. Keep answers under ~250 words unless asked for depth. If asked about live salaries/openings, give best-known ranges and note they vary; suggest using the app's Jobs tab for live listings.`;
  if (mode === 'interview') return base + ' You are running a mock interview. Ask exactly ONE question per message, wait for the answer, then give 2-3 bullet feedback (strengths, improvement) and ask the next question. Escalate difficulty gradually.';
  if (mode === 'resume') return base + ' You are reviewing the user\'s resume. Be honest and constructive: call out weak bullets, suggest stronger action verbs and quantification, and check alignment with the target role.';
  return base;
}

/* ================= JOBS ================= */

const jobsCache = { key: '', at: 0, items: [] };

function norm(str) { return String(str || '').toLowerCase(); }
function pDate(d) { const t = new Date(d).getTime(); return isNaN(t) ? 0 : t; }
// decode HTML entities that some feeds double-escape (e.g. "Data &amp; Analytics")
function deEnt(s) {
  return String(s || '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, k) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }[k] || m));
}

function normalizeRemotive(j) {
  return {
    id: `remotive-${j.id}`, source: 'remotive', title: deEnt(j.title), company: deEnt(j.company_name),
    logo: j.company_logo || '', location: j.candidate_required_location || 'Remote', remote: true,
    type: norm(j.job_type).replace('_', ' '), level: '', tags: (j.tags || []).slice(0, 8),
    category: j.category || '', url: j.url, postedAt: pDate(j.publication_date),
    salary: j.salary || '', description: stripHtml(j.description, 500),
  };
}
function normalizeJobicy(j) {
  return {
    id: `jobicy-${j.id}`, source: 'jobicy', title: deEnt(j.jobTitle), company: deEnt(j.companyName),
    logo: j.companyLogo || '', location: deEnt(j.jobGeo || 'Remote'), remote: true,
    type: norm((j.jobType || [])[0]), level: j.jobLevel && j.jobLevel !== 'Any' ? j.jobLevel : '',
    tags: (j.jobIndustry || []).map(deEnt).slice(0, 8), category: deEnt((j.jobIndustry || [])[0] || ''),
    url: j.url, postedAt: pDate(j.pubDate), salary: j.annualSalaryMin ? `$${j.annualSalaryMin}–$${j.annualSalaryMax}` : '',
    description: j.jobExcerpt ? stripHtml(j.jobExcerpt, 500) : stripHtml(j.jobDescription, 500),
  };
}
function normalizeArbeitnow(j) {
  return {
    id: `arbeitnow-${j.slug}`, source: 'arbeitnow', title: deEnt(j.title), company: deEnt(j.company_name),
    logo: '', location: j.location || 'Europe', remote: !!j.remote,
    type: norm((j.job_types || [])[0]), level: '', tags: (j.tags || []).slice(0, 8),
    category: (j.tags || [])[0] || '', url: j.url, postedAt: (j.created_at || 0) * 1000,
    salary: '', description: stripHtml(j.description, 500), visa: !!j.visa_sponsorship,
  };
}
function normalizeMuse(j) {
  const loc = deEnt((j.locations || []).map((l) => l.name).join(' · '));
  const level = (j.levels || [])[0]?.name || '';
  return {
    id: `muse-${j.id}`, source: 'muse', title: deEnt(j.name), company: deEnt(j.company?.name || ''),
    logo: '', location: loc || '—', remote: /flexible|remote/i.test(loc),
    type: /intern/i.test(level) ? 'internship' : 'full time', level,
    tags: (j.categories || []).map((c) => deEnt(c.name)).slice(0, 8), category: deEnt((j.categories || [])[0]?.name || ''),
    url: j.refs?.landing_page || '', postedAt: pDate(j.publication_date), salary: '',
    description: stripHtml(j.contents, 500),
  };
}

async function fetchSource(source, q, internship) {
  try {
    if (source === 'remotive') {
      const d = await fetchJsonSmart(ENDPOINTS.remotive(q));
      return (d.jobs || []).map(normalizeRemotive);
    }
    if (source === 'jobicy') {
      const d = await fetchJsonSmart(ENDPOINTS.jobicy(q));
      return (d.jobs || []).map(normalizeJobicy);
    }
    if (source === 'arbeitnow') {
      const d = await fetchJsonSmart(ENDPOINTS.arbeitnow());
      return (d.data || []).map(normalizeArbeitnow);
    }
    if (source === 'muse') {
      const pages = internship ? [1, 2] : [1];
      const all = [];
      for (const p of pages) {
        const d = await fetchJsonSmart(ENDPOINTS.muse(p, { internship }));
        all.push(...(d.results || []));
      }
      return all.map(normalizeMuse);
    }
  } catch (e) { console.warn(`[jobs] ${source} failed:`, e.message); return { error: source }; }
  return [];
}

export async function searchJobs({ q = '', internship = false, force = false } = {}) {
  const s = getState();
  const enabled = Object.entries(s?.settings.sources || {}).filter(([, on]) => on).map(([k]) => k);
  const key = JSON.stringify([q, internship, enabled]);
  if (!force && jobsCache.key === key && Date.now() - jobsCache.at < 5 * 60e3) {
    return { items: jobsCache.items, failed: jobsCache.failed, cached: true };
  }
  const results = await Promise.all(enabled.map((src) => fetchSource(src, q, internship)));
  const failed = [];
  let items = [];
  results.forEach((r) => { if (Array.isArray(r)) items.push(...r); else if (r?.error) failed.push(r.error); });
  // dedupe by title+company
  const seen = new Set();
  items = items.filter((j) => {
    if (!j.title || !j.url) return false;
    const k = norm(j.title) + '|' + norm(j.company);
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  Object.assign(jobsCache, { key, at: Date.now(), items, failed });
  return { items, failed, cached: false };
}

export function filterJobs(items, { q = '', type = '', remoteOnly = false, source = '', sort = 'auto' } = {}) {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  let out = items.filter((j) => {
    if (remoteOnly && !j.remote) return false;
    if (source && j.source !== source) return false;
    if (type === 'internship' && !(j.type === 'internship' || /intern(ship)?\b/i.test(j.title))) return false;
    if (type && type !== 'internship' && !norm(j.type).includes(type)) return false;
    if (terms.length) {
      const hay = norm([j.title, j.company, j.category, j.location, (j.tags || []).join(' ')].join(' '));
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  if (sort === 'date' || (sort === 'auto' && !terms.length)) out.sort((a, b) => b.postedAt - a.postedAt);
  else if (terms.length) {
    out.sort((a, b) => relScore(b, terms) - relScore(a, terms) || b.postedAt - a.postedAt);
  }
  return out;
}
function relScore(j, terms) {
  let sc = 0;
  const title = norm(j.title), tags = norm((j.tags || []).join(' '));
  for (const t of terms) {
    if (title.includes(t)) sc += 5;
    if (tags.includes(t)) sc += 2;
    if (norm(j.company).includes(t)) sc += 2;
    if (norm(j.description).includes(t)) sc += 1;
  }
  return sc;
}

// Match scoring vs user profile — for Suggestions
export function matchJobs(items, profile, { internships = false } = {}) {
  const skills = (profile.skills || []).map(norm).filter(Boolean);
  const interests = (profile.interests || []).map(norm).filter(Boolean);
  const target = norm(profile.targetRole);
  const targetWords = target.split(/\s+/).filter((w) => w.length > 2);
  const scored = items.map((j) => {
    const title = norm(j.title), desc = norm(j.description), tags = norm((j.tags || []).join(' ') + ' ' + j.category);
    let score = 0; const matched = new Set();
    for (const sk of skills) {
      if (title.includes(sk)) { score += 6; matched.add(sk); }
      else if (tags.includes(sk)) { score += 4; matched.add(sk); }
      else if (desc.includes(sk)) { score += 2; matched.add(sk); }
    }
    for (const it of interests) {
      if (title.includes(it) || tags.includes(it)) { score += 3; matched.add(it); }
      else if (desc.includes(it)) { score += 1.5; matched.add(it); }
    }
    if (targetWords.length && targetWords.every((w) => title.includes(w))) score += 10;
    else if (targetWords.some((w) => title.includes(w))) score += 4;
    const isIntern = j.type === 'internship' || /intern(ship)?\b/i.test(j.title);
    if (internships) { if (!isIntern) score = 0; }
    else if (isIntern && profile.role !== 'student') score *= 0.4;
    if (profile.openTo?.remote && j.remote) score += 1;
    const denom = Math.max(6, skills.length * 4 + interests.length * 2 + 10);
    const pct = Math.max(4, Math.min(98, Math.round((score / denom) * 100)));
    return { job: j, score, pct, matched: [...matched].slice(0, 6) };
  }).filter((m) => m.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/* ================= ARTICLES ================= */

export async function searchArticles(q) {
  try {
    if (q) {
      // dev.to search endpoint first (free-text), fallback to tag endpoint
      try {
        const d = await fetchJsonSmart(ENDPOINTS.devtoSearch(q));
        const arr = Array.isArray(d) ? d : d.result || [];
        if (arr.length) return arr.map(normalizeArticle);
      } catch { /* fall through */ }
    }
    const d = await fetchJsonSmart(ENDPOINTS.devto(q));
    return (Array.isArray(d) ? d : []).map(normalizeArticle);
  } catch (e) { console.warn('[articles]', e.message); return []; }
}
function normalizeArticle(a) {
  return {
    id: `devto-${a.id}`, kind: 'article', title: a.title, by: a.user?.name || a.organization?.name || 'dev.to',
    url: a.url, cover: a.cover_image || a.social_image || '', mins: a.reading_time_minutes || 4,
    reactions: a.positive_reactions_count || 0, tags: (a.tag_list || []).slice(0, 4),
    date: a.published_timestamp || '', desc: a.description || '',
  };
}

/* ================= VIDEOS ================= */

export async function searchVideos(q) {
  // 1) serverless scraper (works reliably once deployed)
  if (isHttp) {
    try {
      const d = await fetchJson(ENDPOINTS.videos(q), {}, 15000);
      if (d?.items?.length) return d.items.map((v) => ({ ...v, kind: 'video' }));
    } catch (e) { console.warn('[videos] serverless failed:', e.message); }
  }
  // 2) public piped instances
  for (const base of VIDEO_FALLBACK_INSTANCES) {
    try {
      const d = await fetchJson(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`, {}, 7000);
      const items = (d.items || []).filter((i) => i.type === 'stream').slice(0, 12).map((i) => ({
        kind: 'video', id: (i.url || '').replace('/watch?v=', ''), title: i.title,
        by: i.uploaderName || '', thumb: i.thumbnail || '', duration: fmtDur(i.duration),
        views: i.views || 0, url: `https://www.youtube.com${i.url}`,
      }));
      if (items.length) return items;
    } catch { /* next instance */ }
  }
  return []; // caller renders graceful fallback (search links)
}
function fmtDur(sec) {
  sec = Number(sec) || 0; if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function curatedCourses(q, interests = []) {
  const hay = norm(q + ' ' + interests.join(' '));
  const scored = getCourses().map((c) => ({
    c, s: c.match.reduce((acc, m) => acc + (hay.includes(m) ? 1 : 0), 0) + (c.match.length === 0 ? 0.1 : 0),
  }));
  scored.sort((a, b) => b.s - a.s);
  return scored.filter((x) => x.s > 0).slice(0, 6).map((x) => x.c);
}
