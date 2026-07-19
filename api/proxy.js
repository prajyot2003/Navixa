// Vercel serverless: same-origin proxy for allowlisted public JSON APIs (dodges CORS + bot walls)
const ALLOWED_HOSTS = new Set([
  'remotive.com', 'www.remotive.com',
  'jobicy.com', 'www.jobicy.com',
  'www.arbeitnow.com', 'arbeitnow.com',
  'www.themuse.com', 'themuse.com',
  'dev.to',
]);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const url = new URL(String(req.query.url || ''));
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
      return res.status(400).json({ error: 'Host not allowed' });
    }
    const upstream = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 NavixaBot/1.0',
        Accept: 'application/json',
      },
    });
    const text = await upstream.text();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(upstream.status).send(text);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'proxy failed' });
  }
};
