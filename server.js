"use strict";
// Local server: serves public/ and the same api/*.js handlers Vercel runs. No dependencies.
// Usage: npm start  (or: node server.js)   ->  http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT) || 3000;

// Load .env / .env.local for local runs only (values are never printed).
for (const name of [".env.local", ".env"]) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const API = {
  board: require("./api/board"),
  trends: require("./api/trends"),
  day: require("./api/day"),
  health: require("./api/health"),
  analyze: require("./api/analyze"),
  log: require("./api/log"),
};
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const api = /^\/api\/([a-z]+)\/?$/.exec(url.pathname);
  if (api) {
    const fn = API[api[1]];
    if (!fn) { res.statusCode = 404; return res.end("not found"); }
    req.query = Object.fromEntries(url.searchParams);
    const started = Date.now();
    await fn(req, res);
    console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    return;
  }
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.end(buf);
  });
});

server.listen(PORT, () => {
  const key = (process.env.DATA_GO_KR_KEY || "").trim() ? "set" : "NOT set (samples will be shown)";
  const ai = (process.env.OPENAI_API_KEY || "").trim() ? "set" : "NOT set (AI 분석 off)";
  const at = require("./lib/usage").configured() ? "set" : "NOT set (이용 기록 off)";
  console.log(`ICN check board running at http://localhost:${PORT}  (DATA_GO_KR_KEY: ${key}, OPENAI_API_KEY: ${ai}, AIRTABLE: ${at})`);
});
