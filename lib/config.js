"use strict";
// Shared server-side settings. Nothing here is ever sent to the browser.
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

module.exports = {
  ROOT,
  API_BASE: "https://apis.data.go.kr/B551177",
  // Cache lifetimes (ms)
  TTL: {
    flights: 5 * 60 * 1000, // 운항 현황 5분
    weather: 30 * 60 * 1000, // 기상 30분
    passenger: 10 * 60 * 1000, // 승객예고: 오늘·내일만 저장, 10분마다 새로 받음
    trends: 6 * 60 * 60 * 1000, // 지난 3일 운항(바뀌지 않음) 6시간
  },
  // 운항 API가 자료를 주는 범위: 오늘 기준 3일 전 ~ 6일 뒤 (2026-11 실측)
  DAY_RANGE: { past: 3, future: 6 },
  FLIGHT_ROWS: 500,
  WEATHER_ROWS: 500,
  REQUEST_TIMEOUT_MS: 12000,
  SAMPLE_DIR: path.join(ROOT, "data", "samples"),
  // Vercel functions can only write to /tmp
  CACHE_DIR: process.env.VERCEL ? path.join("/tmp", "icn-cache") : path.join(ROOT, "data", "cache"),
  DELAY_THRESHOLD_MIN: 15,
};
