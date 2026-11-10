"use strict";
// The data.go.kr service key lives ONLY in the server environment (DATA_GO_KR_KEY).
// It is never logged, returned in a response, or sent to the browser.

function rawKey() {
  return (process.env.DATA_GO_KR_KEY || "").trim();
}

function hasKey() {
  return rawKey().length > 0;
}

// data.go.kr issues an already-encoded key and a decoded key; only encode the decoded form.
function encodedKey() {
  const k = rawKey();
  return /%[0-9A-Fa-f]{2}/.test(k) ? k : encodeURIComponent(k);
}

// Remove any form of the key from a string (error messages, upstream bodies).
function scrub(text) {
  let out = String(text ?? "");
  const k = rawKey();
  if (!k) return out;
  const variants = new Set([k, encodedKey()]);
  try { variants.add(decodeURIComponent(k)); } catch (e) { /* not encoded */ }
  for (const v of variants) if (v && v.length >= 8) out = out.split(v).join("<key>");
  return out.replace(/serviceKey=[^&\s"']+/gi, "serviceKey=<key>");
}

module.exports = { hasKey, encodedKey, scrub };
