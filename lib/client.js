"use strict";
// Thin data.go.kr client: one call, and "fetch every page until totalCount".
const { API_BASE, REQUEST_TIMEOUT_MS } = require("./config");
const { hasKey, encodedKey, scrub } = require("./key");

class ApiError extends Error {
  constructor(message, code) { super(scrub(message)); this.code = code || "API_ERROR"; }
}

function itemsOf(body) {
  let it = body?.items ?? [];
  if (it && !Array.isArray(it) && typeof it === "object") it = it.item ?? [];
  if (!Array.isArray(it)) it = it ? [it] : [];
  return it;
}

async function call(path, params) {
  if (!hasKey()) throw new ApiError("DATA_GO_KR_KEY is not set", "NO_KEY");
  const qs = new URLSearchParams({ type: "json", ...params }).toString();
  const url = `${API_BASE}/${path}?serviceKey=${encodedKey()}&${qs}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let text;
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    text = await res.text();
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, "HTTP_" + res.status);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e.name === "AbortError" ? "timeout" : `network: ${e.message}`, "NETWORK");
  } finally {
    clearTimeout(timer);
  }
  let data;
  try { data = JSON.parse(text); } catch (e) {
    // data.go.kr gateway errors come back as XML even when JSON was requested
    const m = /<returnAuthMsg>([^<]+)</.exec(text) || /<errMsg>([^<]+)</.exec(text);
    throw new ApiError(`non-JSON response${m ? ": " + m[1] : ""}`, "BAD_RESPONSE");
  }
  const header = data?.response?.header;
  if (!header || header.resultCode !== "00") {
    throw new ApiError(`resultCode ${header?.resultCode}: ${header?.resultMsg || ""}`, "RESULT_" + (header?.resultCode || "NA"));
  }
  return data.response.body;
}

// Page through until received === totalCount. Any failed page fails the whole fetch.
async function fetchAll(path, params, rows) {
  const items = [];
  let total = null;
  let page = 1;
  for (; page <= 50; page++) {
    const body = await call(path, { ...params, numOfRows: rows, pageNo: page });
    total = Number(body.totalCount || 0);
    const batch = itemsOf(body);
    items.push(...batch);
    if (!batch.length || items.length >= total) break;
  }
  if (total !== null && items.length !== total) {
    throw new ApiError(`incomplete paging: ${items.length}/${total}`, "INCOMPLETE");
  }
  return { items, total, pages: page };
}

module.exports = { call, fetchAll, ApiError };
