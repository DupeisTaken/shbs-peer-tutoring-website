import { register } from "node:module";

// The standalone server uses normal React because Auth.js imports Next's
// navigation entry. Only the server-only marker selects its published server
// condition, through the exact-specifier hook below. No module is mocked.
register("./server-runtime-hooks.mjs", import.meta.url);
globalThis[Symbol.for("shbs.scheduling-profile.server-runtime")] = 1;
