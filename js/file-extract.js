// Navixa — general file → text extraction for the AI chat.
// Handles PDF (pdf.js), Word .docx (JSZip), and any UTF-8 text/code/data file.
// Binary formats we can't read (images, audio, video, xlsx, zip, …) throw a
// clear, user-facing error. Parsers are lazy-loaded from a CDN on first use.

const CDN = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
};

const MAX_BYTES = 8 * 1024 * 1024;   // 8 MB upload cap
const MAX_CHARS = 14000;             // chars handed to the model

// Extensions we confidently read as plain text (covers docs, data and code).
const TEXT_EXT = new Set([
  'txt', 'text', 'md', 'markdown', 'rst', 'log', 'csv', 'tsv', 'json', 'jsonl', 'ndjson',
  'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'svg',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte',
  'py', 'rb', 'php', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'go', 'rs',
  'swift', 'scala', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'sql', 'r', 'lua', 'pl', 'dart',
  'gradle', 'dockerfile', 'makefile', 'gitignore', 'graphql', 'gql', 'proto',
]);

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

async function extractPdf(file) {
  await loadScript(CDN.pdf);
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) throw new Error('PDF reader unavailable');
  pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const out = [];
  const pages = Math.min(pdf.numPages, 40);
  for (let p = 1; p <= pages; p++) {
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
  return out.join('\n');
}

async function extractDocx(file) {
  await loadScript(CDN.jszip);
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error('Word reader unavailable');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('That doesn’t look like a Word document');
  const xml = await doc.async('string');
  const lines = xml.split(/<\/w:p>/).map((para) => {
    const seg = para.replace(/<w:tab\b[^>]*\/?>/g, '\t').replace(/<w:br\b[^>]*\/?>/g, '\n');
    return [...seg.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((m) => decodeXml(m[1])).join('');
  });
  return lines.join('\n');
}

function decodeXml(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
}

// Heuristic: does this string look like binary garbage rather than text?
function looksBinary(s) {
  const n = Math.min(s.length, 1000);
  if (!n) return false;
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) return true;                       // NUL → definitely binary
    if (c === 0xFFFD) ctrl++;                        // replacement char
    else if (c < 9 || (c > 13 && c < 32)) ctrl++;    // odd control chars
  }
  return ctrl / n > 0.1;
}

/**
 * Read a file to text. Returns { name, size, text, truncated }.
 * Throws an Error with a friendly, user-facing message when it can't.
 */
export async function extractFileText(file) {
  if (!file) throw new Error('No file selected');
  if (file.size > MAX_BYTES) throw new Error('That file is over 8 MB — please attach a smaller one');

  const name = (file.name || 'file').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const type = file.type || '';
  let raw;

  if (ext === 'pdf' || type === 'application/pdf') {
    raw = await extractPdf(file);
  } else if (ext === 'docx' || type.includes('officedocument.wordprocessingml')) {
    raw = await extractDocx(file);
  } else if (
    TEXT_EXT.has(ext) || TEXT_EXT.has(name) ||
    type.startsWith('text/') || type === 'application/json' ||
    type === 'application/xml' || /\+(xml|json)$/.test(type) ||
    /(javascript|ecmascript|x-sh|x-yaml|csv)/.test(type)
  ) {
    raw = await file.text();
  } else {
    // Unknown type — try reading as text and accept only if it's genuinely textual.
    let t = '';
    try { t = await file.text(); } catch { t = ''; }
    if (!t || looksBinary(t)) {
      throw new Error(`I can’t read “${file.name}”. I can analyse text, code, PDF, Word (.docx), CSV and JSON files — but not images, spreadsheets or other binary formats.`);
    }
    raw = t;
  }

  raw = (raw || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (raw.replace(/\s/g, '').length < 3) {
    throw new Error(`No readable text found in “${file.name}”. If it’s a scanned image, the text can’t be extracted.`);
  }

  const truncated = raw.length > MAX_CHARS;
  return { name: file.name, size: file.size, text: truncated ? raw.slice(0, MAX_CHARS) : raw, truncated };
}
