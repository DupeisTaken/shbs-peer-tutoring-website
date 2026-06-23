// Allow side-effect imports of stylesheets, e.g. `import "~/styles/globals.css"`.
// TypeScript 6 + verbatimModuleSyntax otherwise errors TS2882 (no type for the side-effect import).
declare module "*.css";
