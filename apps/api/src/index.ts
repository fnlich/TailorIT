// Placeholder entry point; replaced by work package F3 (API core).
import express from 'express';

const port = Number(process.env.API_PORT ?? 4100);
const app = express();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'tailorit-api' });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`[api] listening on http://127.0.0.1:${port}`);
});
