const path = require("node:path");
const { globSync: tinyGlobSync } = require("tinyglobby");

// Scoped to Next's getRootDirs helper: this is not a general fast-glob replacement.
// Fail loudly if an upstream update starts using a different API or option.
/**
 * @param {string} pattern
 * @param {{ onlyDirectories: true }} options
 */
exports.globSync = (pattern, options) => {
  if (
    typeof pattern !== "string" ||
    options?.onlyDirectories !== true ||
    Object.keys(options).some((key) => key !== "onlyDirectories")
  ) {
    throw new TypeError(
      "Next lint glob adapter only supports directory root patterns",
    );
  }

  return tinyGlobSync(pattern, {
    onlyDirectories: true,
    // fast-glob returns a literal directory, not its descendants. Explicit absolute
    // output also preserves absolute Windows roots, including those on another drive.
    expandDirectories: false,
    absolute: path.isAbsolute(pattern),
  });
};
