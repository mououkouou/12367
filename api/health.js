"use strict";
// GET /api/health — says whether the server has a key configured (never the key itself).
const { hasKey } = require("../lib/key");
const { kstIso } = require("../lib/time");
const { handler } = require("../lib/http");

module.exports = handler(() => ({ ok: true, keyConfigured: hasKey(), time: kstIso() }));
