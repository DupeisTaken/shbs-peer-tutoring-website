"use strict";

// ESLint's v3 consumers call the CommonJS export directly; modern minimatch
// exposes the same matcher as a named export. Keep matching in the patched
// upstream implementation and adapt only this module boundary.
const modern = require("minimatch-modern");

// Only eslint-plugin-import's no-internal-modules rule uses makeRe, and it
// consumes only .test(path). v11 deliberately removed regex generation; keep
// that consumer on its bounded matcher rather than recreating legacy regexes.
/**
 * @param {string} pattern
 * @param {import("minimatch-modern").MinimatchOptions} [options]
 */
function makeRe(pattern, options) {
  const matcher = new modern.Minimatch(pattern, options);
  return Object.freeze({ test: matcher.match.bind(matcher) });
}

module.exports = Object.assign(modern.minimatch, modern, { makeRe });
