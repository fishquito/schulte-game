'use strict';
/** HTTP 小工具：响应、CORS、读 body、限流。跟具体游戏无关。 */

const MAX_BODY    = 4096;
const RATE_WINDOW = 60000;
const RATE_LIMIT  = 30;      // 每 IP 每窗口最多写操作次数

function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || now > h.until) { h = { n: 0, until: now + RATE_WINDOW }; hits.set(ip, h); }
  h.n++;
  if (hits.size > 5000) hits.clear();
  return h.n > RATE_LIMIT;
}

const ipOf = req =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '-';

module.exports = { cors, send, readBody, rateLimited, ipOf, MAX_BODY };
