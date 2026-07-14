import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createHash } from 'node:crypto';

const PUBLIC_DIR = join(process.cwd(), 'public');
const FIXED_ENCODING_KEY = 'b36a8472fe418d9f80d6bb1c54e3a6e62c62936aa7bf31dae2bcf7e929f6430f';
const ALLOWED_MODELS = new Set([
  'nai-diffusion-4-5-full',
  'nai-diffusion-4-5-curated',
  'nai-diffusion-4-full',
  'nai-diffusion-4-curated-preview',
]);

function loadDotEnv() {
  return readFile('.env', 'utf8').then((text) => {
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }).catch(() => {});
}
await loadDotEnv();
const PORT = Number(process.env.PORT || 3000);
const API_BASE = (process.env.NOVELAI_API_BASE || 'https://image.novelai.net').replace(/\/+$/, '');
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES || 10 * 1024 * 1024);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 10);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000);
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 60_000);
const rateLimits = new Map();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket.remoteAddress || 'unknown')
    .split(',')[0].trim();
}

function checkRateLimit(req, res) {
  const now = Date.now();
  const ip = getClientIp(req);
  let record = rateLimits.get(ip);
  if (!record || now >= record.resetAt) {
    record = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimits.set(ip, record);
  }
  record.count += 1;
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX - record.count));
  res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));
  if (record.count > RATE_LIMIT_MAX) {
    res.setHeader('Retry-After', Math.max(1, Math.ceil((record.resetAt - now) / 1000)));
    sendJson(res, 429, { error: '请求过于频繁，请稍后再试' });
    return false;
  }
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimits) if (now >= record.resetAt) rateLimits.delete(ip);
}, Math.min(RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000)).unref();

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > Math.ceil(MAX_IMAGE_BYTES * 1.5) + 100_000) throw Object.assign(new Error('请求体过大'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求 JSON 无效'), { status: 400 }); }
}

function getModelKey(model) {
  if (model.includes('4-5-curated')) return 'v4-5curated';
  if (model.includes('4-5-full')) return 'v4-5full';
  if (model.includes('4-curated')) return 'v4curated';
  if (model.includes('4-full')) return 'v4full';
  return model;
}

function parseImage(input) {
  if (typeof input !== 'string' || !input) throw Object.assign(new Error('缺少图片'), { status: 400 });
  const match = input.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  const mime = match ? match[1].toLowerCase() : 'image/png';
  const base64 = (match ? match[2] : input).replace(/\s/g, '');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw Object.assign(new Error('图片 Base64 无效'), { status: 400 });
  if (bytes.length > MAX_IMAGE_BYTES) throw Object.assign(new Error(`图片不能超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`), { status: 413 });
  return { mime, base64, bytes };
}

function buildVibeJson({ imageBase64, encodedBase64, model, strength, thumbnail }) {
  const id = createHash('sha256').update(imageBase64, 'utf8').digest('hex');
  const encoding = { encoding: encodedBase64, params: { information_extracted: 1 } };
  return {
    identifier: 'novelai-vibe-transfer',
    version: 1,
    type: 'image',
    image: imageBase64,
    id,
    encodings: { [getModelKey(model)]: { [FIXED_ENCODING_KEY]: encoding } },
    name: `${id.slice(0, 6)}-${id.slice(-6)}`,
    thumbnail,
    createdAt: Date.now(),
    importInfo: { model, information_extracted: 1, strength },
  };
}

async function encodeVibe(req, res) {
  const body = await readJson(req);
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) throw Object.assign(new Error('请填写 NovelAI Token'), { status: 400 });
  if (token.length > 4096 || /[\r\n]/.test(token)) throw Object.assign(new Error('Token 格式无效'), { status: 400 });
  const model = String(body.model || '');
  const strength = Number(body.strength ?? 0.6);
  if (!ALLOWED_MODELS.has(model)) throw Object.assign(new Error('不支持的模型'), { status: 400 });
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw Object.assign(new Error('strength 必须在 0 到 1 之间'), { status: 400 });
  const image = parseImage(body.image);

  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/ai/encode-vibe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ image: image.base64, information_extracted: 1, model }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw Object.assign(new Error('NovelAI 编码超时，请稍后重试'), { status: 504 });
    }
    throw Object.assign(new Error('无法连接 NovelAI 编码服务'), { status: 502 });
  }
  if (!upstream.ok) {
    const text = await upstream.text();
    let message = text || upstream.statusText;
    try { message = JSON.parse(text).message || message; } catch {}
    throw Object.assign(new Error(`NovelAI API 错误 (${upstream.status}): ${message}`), { status: upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502 });
  }
  const encoded = Buffer.from(await upstream.arrayBuffer());
  if (encoded.length < 8) throw Object.assign(new Error('上游返回的 Vibe 编码异常'), { status: 502 });
  const thumbnail = typeof body.thumbnail === 'string' && body.thumbnail.startsWith('data:image/jpeg;base64,') ? body.thumbnail : `data:${image.mime};base64,${image.base64}`;
  const vibe = buildVibeJson({ imageBase64: image.base64, encodedBase64: encoded.toString('base64'), model, strength, thumbnail });
  const filename = `${vibe.name}.naiv4vibe`;
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Vibe-Filename': filename,
  });
  res.end(JSON.stringify(vibe));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
async function serveStatic(urlPath, res) {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const clean = normalize(decodeURIComponent(requested)).replace(/^(\.\.(\/|\\|$))+/, '');
  const file = join(PUBLIC_DIR, clean);
  if (!file.startsWith(PUBLIC_DIR)) return false;
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
    return true;
  } catch { return false; }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'POST' && url.pathname === '/api/vibe') {
      if (!checkRateLimit(req, res)) return;
      return await encodeVibe(req, res);
    }
    if (req.method === 'GET' && await serveStatic(url.pathname, res)) return;
    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    sendJson(res, error.status || 500, { error: error.message || '服务器错误' });
  }
}).listen(PORT, () => console.log(`NovelAI Vibe Web: http://localhost:${PORT}`));
