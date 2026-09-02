// Vercel serverless: YouTube video search (scrapes results page; falls back to Piped instances)
const { blocked } = require('./_guard');

const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.private.coffee',
  'https://pipedapi.adminforge.de',
];

async function scrapeYouTube(q) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en&gl=US`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: 'CONSENT=YES+cb; SOCS=CAI',
    },
  });
  if (!r.ok) throw new Error(`yt ${r.status}`);
  const html = await r.text();
  const m = html.match(/var ytInitialData = (\{[\s\S]+?\});<\/script>/);
  if (!m) throw new Error('no ytInitialData');
  const data = JSON.parse(m[1]);
  const items = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object' || items.length >= 14) return;
    if (node.videoRenderer?.videoId) {
      const v = node.videoRenderer;
      items.push({
        id: v.videoId,
        title: (v.title?.runs || []).map((x) => x.text).join('') || v.title?.simpleText || '',
        by: v.ownerText?.runs?.[0]?.text || '',
        duration: v.lengthText?.simpleText || '',
        views: parseViews(v.viewCountText?.simpleText || ''),
        thumb: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
      });
      return;
    }
    for (const k of Object.keys(node)) walk(node[k]);
  };
  walk(data.contents);
  if (!items.length) throw new Error('no videos parsed');
  return items;
}
function parseViews(s) {
  const m = String(s).replace(/[,.]/g, '').match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

async function pipedSearch(q) {
  for (const base of PIPED) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const d = await r.json();
      const items = (d.items || []).filter((i) => i.type === 'stream').slice(0, 14).map((i) => ({
        id: (i.url || '').replace('/watch?v=', ''),
        title: i.title, by: i.uploaderName || '', duration: fmtDur(i.duration),
        views: i.views || 0, thumb: i.thumbnail || '', url: `https://www.youtube.com${i.url}`,
      }));
      if (items.length) return items;
    } catch { /* next */ }
  }
  throw new Error('all piped instances failed');
}
function fmtDur(sec) {
  sec = Number(sec) || 0; if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  if (await blocked(req, res, { bucket: 'videos', limit: 30, windowMs: 60_000 })) return;
  const q = String(req.query.q || '').slice(0, 120).trim();
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    let items;
    try { items = await scrapeYouTube(q); }
    catch { items = await pipedSearch(q); }
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(200).json({ items: [], fallback: true, error: e.message });
  }
};
