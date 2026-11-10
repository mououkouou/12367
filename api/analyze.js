"use strict";
// POST /api/analyze — AI summary of the aggregates currently on screen. The OpenAI key stays on the server.
const { analyze, AI } = require("../lib/ai");
const { sendJson } = require("../lib/http");

const MESSAGES = {
  NO_AI_KEY: [503, "서버에 OPENAI_API_KEY가 설정되지 않아 AI 분석을 쓸 수 없어요."],
  BAD_INPUT: [400, "보낼 수 없는 화면 값이에요. 새로고침 후 다시 시도해 주세요."],
  TOO_LARGE: [413, "보내는 값이 너무 커요."],
  TOO_FAST: [429, "조금 전에 분석을 요청했어요. 몇 초 뒤 다시 눌러 주세요."],
  AI_RATE_LIMIT: [429, "AI 사용 한도에 걸렸어요. 잠시 후 다시 시도해 주세요."],
  AI_AUTH: [502, "AI 서비스 인증에 실패했어요. 서버의 OPENAI_API_KEY를 확인해 주세요."],
  TIMEOUT: [504, "AI 응답이 늦어 중단했어요. 잠시 후 다시 시도해 주세요."],
  AI_TOO_LONG: [502, "AI 답이 길이 제한에 걸려 끝까지 오지 않았어요. 다시 시도해 주세요."],
  AI_INCOMPLETE: [502, "AI 답이 끝까지 오지 않았어요. 잠시 후 다시 시도해 주세요."],
  CHECK_FAILED: [502, "AI 답에 화면에 없는 숫자나 단정 표현이 있어 보여드리지 않았어요. 다시 시도해 주세요."],
};

function readBody(req) {
  if (req.body !== undefined) { // Vercel parses JSON bodies
    const text = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    return Promise.resolve(text);
  }
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    // keep reading (but not storing) past the limit so the client still gets a clean 413
    req.on("data", (c) => { size += c.length; if (size <= AI.MAX_INPUT_BYTES) chunks.push(c); });
    req.on("end", () => (size > AI.MAX_INPUT_BYTES ? reject(Object.assign(new Error("too large"), { code: "TOO_LARGE" })) : resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  try {
    const text = await readBody(req);
    if (Buffer.byteLength(text) > AI.MAX_INPUT_BYTES) throw Object.assign(new Error("too large"), { code: "TOO_LARGE" });
    let body;
    try { body = JSON.parse(text || "{}"); } catch (e) { throw Object.assign(new Error("invalid JSON"), { code: "BAD_INPUT" }); }
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local").split(",")[0].trim();
    sendJson(res, 200, await analyze(body, ip), "no-store");
  } catch (err) {
    const [status, msg] = MESSAGES[err.code] || [502, "AI 분석을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."];
    if (!MESSAGES[err.code]) console.error("analyze failed:", err.code || err.name);
    sendJson(res, status, { error: msg, code: err.code || "ERROR", ...(err.reason ? { reason: String(err.reason).slice(0, 40) } : {}) });
  }
};
