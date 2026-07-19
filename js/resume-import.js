// Navixa — resume import: pull text out of PDF / Word (.docx) files and map it
// into the resume schema. Uses the AI gateway to structure the content when
// reachable, and always falls back to heuristics so contact details + skills
// populate even offline. Parsers are loaded lazily from a CDN on first use.
import { llmChat } from './api.js';

const CDN = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the file reader — check your connection'));
    document.head.appendChild(s);
  });
}

/* ---------- text extraction ---------- */
async function extractPdfText(file) {
  await loadScript(CDN.pdf);
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) throw new Error('PDF reader unavailable');
  pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    let lastY = null, line = '';
    for (const it of tc.items) {
      const y = it.transform ? it.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) { out.push(line.trimEnd()); line = ''; }
      line += (it.str || '') + (it.hasEOL ? '' : ' ');
      if (it.hasEOL) { out.push(line.trimEnd()); line = ''; }
      lastY = y;
    }
    if (line.trim()) out.push(line.trimEnd());
    out.push('');
  }
  return tidy(out.join('\n'));
}

async function extractDocxText(file) {
  await loadScript(CDN.jszip);
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error('Word reader unavailable');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('That doesn’t look like a Word document');
  const xml = await doc.async('string');
  const lines = xml.split(/<\/w:p>/).map((para) => {
    const seg = para.replace(/<w:tab\b[^>]*\/?>/g, '\t').replace(/<w:br\b[^>]*\/?>/g, '\n');
    const runs = [...seg.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => decodeXml(m[1]));
    return runs.join('');
  });
  return tidy(lines.join('\n'));
}

function decodeXml(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
}
function tidy(s) {
  return String(s).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- structuring ---------- */
const SCHEMA = '{"basics":{"name":"","email":"","phone":"","location":"","headline":"","linkedin":"","github":"","website":""},"summary":"","experience":[{"role":"","company":"","location":"","start":"","end":"","bullets":[""]}],"projects":[{"name":"","link":"","desc":"","bullets":[""]}],"education":[{"degree":"","school":"","year":"","score":""}],"skills":[""],"certifications":[{"name":"","by":"","year":""}]}';

async function parseWithLLM(text) {
  // NOTE: do NOT pass an AbortSignal to llmChat — the free gateway stalls on
  // aborted-capable requests. Enforce the deadline with Promise.race instead.
  const call = llmChat([
    { role: 'system', content: `You extract a resume into structured data. Output ONLY valid minified JSON matching exactly these keys, no prose, no markdown fences: ${SCHEMA}. Use "" or [] for anything missing. Keep bullet wording verbatim from the resume. Dates exactly as written. "headline" = the person's target role/title.` },
    { role: 'user', content: text.slice(0, 12000) },
  ], { temperature: 0 });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('LLM timeout')), 25000));
  const raw = await Promise.race([call, timeout]);
  return extractJson(raw);
}

function extractJson(raw) {
  let s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  const obj = JSON.parse(s);
  if (!obj || typeof obj !== 'object' || !obj.basics) throw new Error('no basics');
  return obj;
}

const HEADINGS = {
  summary: /^(summary|profile|objective|about( me)?)\b/i,
  skills: /^(technical )?(skills|core competencies|technologies|tech stack)\b/i,
  experience: /^(work |professional )?(experience|employment|work history)\b/i,
  education: /^education\b/i,
  projects: /^projects?\b/i,
  certifications: /^(certifications?|licenses?)\b/i,
};

function parseHeuristic(text) {
  const r = { basics: {}, summary: '', skills: [], experience: [], projects: [], education: [], certifications: [] };
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (email) r.basics.email = email[0];
  const phone = text.match(/(\+?\d[\d\s().-]{8,}\d)/);
  if (phone) r.basics.phone = phone[0].trim();
  const li = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s|,)]+/i);
  if (li) r.basics.linkedin = li[0];
  const gh = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s|,)]+/i);
  if (gh) r.basics.github = gh[0];

  const lines = text.split('\n').map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);
  const nameLine = nonEmpty.slice(0, 6).find((l) => !/@|\d|http|www\./i.test(l)
    && /^[A-Za-z][A-Za-z.'’\- ]+$/.test(l) && l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 5);
  if (nameLine) r.basics.name = nameLine;

  // group lines into sections by recognizable headings
  const buckets = {};
  let current = null;
  for (const raw of lines) {
    const l = raw.trim();
    let matched = null;
    for (const [key, re] of Object.entries(HEADINGS)) { if (l && l.length < 40 && re.test(l)) { matched = key; break; } }
    if (matched) { current = matched; buckets[current] = buckets[current] || []; continue; }
    if (current) buckets[current].push(l);
  }
  if (buckets.summary) r.summary = buckets.summary.filter(Boolean).join(' ').slice(0, 800);
  if (buckets.skills) {
    r.skills = buckets.skills.join('\n').split(/[,•|\n·;]+/).map((s) => s.replace(/^[-–]\s*/, '').trim())
      .filter((s) => s && s.length <= 40).slice(0, 20);
  }
  if (buckets.experience) {
    r.experience = groupEntries(buckets.experience).slice(0, 10).map((e) => {
      const h = splitRoleHeader(e.header);
      return { role: h.role, company: h.company, location: '', start: h.start, end: h.end, bullets: e.bullets.slice(0, 10) };
    }).filter((e) => e.role || e.company || e.bullets.length);
  }
  if (buckets.education) {
    r.education = buckets.education.filter(Boolean).slice(0, 6).map((l) => {
      const yr = (l.match(/((?:19|20)\d{2})(?:\s*[–—-]\s*((?:19|20)\d{2}|present|current))?/i) || [])[0] || '';
      const score = (l.match(/((?:C?GPA|percentage|first class)[^,•|]*)/i) || [])[0].trim() || '';
      const head = l.replace(/\([^)]*\)/g, '').replace(/,?\s*(?:C?GPA|percentage)[^,•|]*/i, '').trim();
      const parts = head.split(/\s[—–]\s|\s+at\s+/i).map((s) => s.trim().replace(/,\s*$/, '')).filter(Boolean);
      return { degree: parts[0] || l, school: parts[1] || '', year: yr, score };
    }).filter((e) => e.degree);
  }
  return r;
}

// Split a section's lines into { header, bullets[] } entries. A line that looks
// like a job/role header (has a year, an em/en-dash split, or " at ") starts a
// new entry; the lines under it become its bullets.
function groupEntries(lines) {
  const isHeader = (l) => /\b(?:19|20)\d{2}\b/.test(l) || /\s[—–]\s/.test(l) || /\bat\b/i.test(l);
  const entries = [];
  let cur = null;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    const marked = /^[-•*·▪]\s+/.test(l);
    if (!marked && isHeader(l)) { cur = { header: l, bullets: [] }; entries.push(cur); }
    else if (cur) cur.bullets.push(l.replace(/^[-•*·▪]\s+/, ''));
    else { cur = { header: l, bullets: [] }; entries.push(cur); }
  }
  return entries;
}

function splitRoleHeader(h) {
  const date = h.match(/((?:[A-Za-z]{3,9}\.?\s?)?(?:19|20)\d{2})\s*[–—-]\s*(present|current|(?:[A-Za-z]{3,9}\.?\s?)?(?:19|20)\d{2})/i);
  const start = date ? date[1].trim() : '';
  const end = date ? date[2].trim() : '';
  const rest = h.replace(/\([^)]*\)/g, '').replace(/,\s*[A-Za-z ]+$/, '').trim();
  const parts = rest.split(/\s[—–]\s|\s-\s|\s+at\s+|\s*\|\s*/i).map((s) => s.trim()).filter(Boolean);
  return { role: parts[0] || '', company: parts[1] || '', start, end };
}

/* ---------- shape guard ---------- */
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
function sanitize(p) {
  const b = p.basics || {};
  return {
    basics: {
      name: str(b.name), email: str(b.email), phone: str(b.phone), location: str(b.location),
      headline: str(b.headline), website: str(b.website), linkedin: str(b.linkedin), github: str(b.github),
    },
    summary: str(p.summary),
    experience: arr(p.experience).slice(0, 12).map((e) => ({
      role: str(e.role), company: str(e.company), location: str(e.location),
      start: str(e.start), end: str(e.end), bullets: arr(e.bullets).map(str).map((x) => x.trim()).filter(Boolean).slice(0, 12),
    })).filter((e) => e.role || e.company || e.bullets.length),
    projects: arr(p.projects).slice(0, 12).map((e) => ({
      name: str(e.name), link: str(e.link), desc: str(e.desc), bullets: arr(e.bullets).map(str).map((x) => x.trim()).filter(Boolean).slice(0, 12),
    })).filter((e) => e.name || e.bullets.length),
    education: arr(p.education).slice(0, 10).map((e) => ({
      degree: str(e.degree), school: str(e.school), year: str(e.year), score: str(e.score),
    })).filter((e) => e.degree || e.school),
    skills: arr(p.skills).map(str).map((s) => s.trim()).filter(Boolean).slice(0, 20),
    certifications: arr(p.certifications).slice(0, 12).map((e) => ({
      name: str(e.name), by: str(e.by), year: str(e.year),
    })).filter((e) => e.name),
  };
}

/* ---------- public API ---------- */
export async function importResumeFromFile(file) {
  const name = (file.name || '').toLowerCase();
  const type = file.type || '';
  let text;
  if (name.endsWith('.pdf') || type === 'application/pdf') text = await extractPdfText(file);
  else if (name.endsWith('.docx') || type.includes('officedocument.wordprocessingml')) text = await extractDocxText(file);
  else throw new Error('Please choose a PDF, Word (.docx) or Navixa JSON file');

  if (!text || text.replace(/\s/g, '').length < 20) {
    throw new Error('No readable text found — a scanned/image resume can’t be parsed');
  }

  let parsed;
  try { parsed = await parseWithLLM(text); }
  catch { parsed = parseHeuristic(text); }

  // always backfill contact + skills from heuristics if the model missed them
  const h = parseHeuristic(text);
  parsed.basics = parsed.basics || {};
  for (const k of ['name', 'email', 'phone', 'linkedin', 'github', 'location']) {
    if (!parsed.basics[k] && h.basics[k]) parsed.basics[k] = h.basics[k];
  }
  if (!str(parsed.summary) && h.summary) parsed.summary = h.summary;
  if ((!Array.isArray(parsed.skills) || !parsed.skills.length) && h.skills.length) parsed.skills = h.skills;

  return sanitize(parsed);
}
