"use strict";
// Memory cache with optional file persistence, request de-duplication and stale fallback.
const fs = require("fs");
const path = require("path");
const { CACHE_DIR } = require("./config");

const mem = new Map(); // key -> { value, at }
const inflight = new Map(); // key -> Promise

function fileOf(key) {
  return path.join(CACHE_DIR, key.replace(/[^a-z0-9_-]/gi, "_") + ".json");
}

function readFile(key) {
  try { return JSON.parse(fs.readFileSync(fileOf(key), "utf8")); } catch (e) { return null; }
}

function writeFile(key, entry) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(fileOf(key), JSON.stringify(entry));
  } catch (e) { /* read-only FS: memory cache still works */ }
}

/**
 * Returns { value, at, cache } where cache is "hit" | "miss" | "stale".
 * On loader failure a previous (expired) entry is returned as "stale"; otherwise the error is thrown.
 */
async function cached(key, ttl, loader, { persist = false } = {}) {
  const now = Date.now();
  let entry = mem.get(key);
  if (!entry && persist) {
    entry = readFile(key);
    if (entry) mem.set(key, entry);
  }
  if (entry && now - entry.at < ttl) return { ...entry, cache: "hit" };
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const value = await loader();
      const fresh = { value, at: Date.now() };
      mem.set(key, fresh);
      if (persist) writeFile(key, fresh);
      return { ...fresh, cache: "miss" };
    } catch (err) {
      if (entry) return { ...entry, cache: "stale", error: err };
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// Keep only the given persisted keys that start with prefix (e.g. passenger: today + tomorrow only).
function prune(prefix, keepKeys) {
  const keep = new Set(keepKeys.map((k) => path.basename(fileOf(k))));
  for (const k of [...mem.keys()]) if (k.startsWith(prefix) && !keepKeys.includes(k)) mem.delete(k);
  try {
    const safe = prefix.replace(/[^a-z0-9_-]/gi, "_");
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (f.startsWith(safe) && !keep.has(f)) fs.unlinkSync(path.join(CACHE_DIR, f));
    }
  } catch (e) { /* nothing to prune */ }
}

module.exports = { cached, prune };
