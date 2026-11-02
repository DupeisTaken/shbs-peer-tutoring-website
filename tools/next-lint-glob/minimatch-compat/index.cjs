"use strict";

// ESLint's v3 consumers call the CommonJS export directly; modern minimatch
// exposes the same matcher as a named export. Keep matching in the patched
// upstream implementation and adapt only this module boundary.
const modern = require("minimatch-modern");
module.exports = Object.assign(modern.minimatch, modern);
