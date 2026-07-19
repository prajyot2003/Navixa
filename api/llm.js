// Vercel serverless: relay chat completions to the free keyless gateway (avoids client CORS/network issues)
const UPSTREAM = 'https://api.llm7.io/v1/chat/completions';
const ALLOWED_MODELS = new Set(['gemma3:27b', 'minimax-m2.7', 'codestral-latest']);

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
    const model = ALLOWED_MODELS.has(body.model) ? body.model : 'gemma3:27b';
    const payload = {
      model,
      messages: (body.messages || []).slice(-40).map((m) => ({ role: String(m.role), content: String(m.content).slice(0, 8000) })),
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
      stream: !!body.stream,
    };
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).json({ error: `Upstream ${upstream.status}`, detail: text.slice(0, 300) });
    }
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', ct);
    if (payload.stream && ct.includes('event-stream') && upstream.body) {
      res.setHeader('Cache-Control', 'no-cache');
      for await (const chunk of upstream.body) res.write(chunk);
      return res.end();
    }
    const data = await upstream.text();
    return res.status(200).send(data);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'relay failed' });
  }
};
