// Vercel Function entry point. `npm run build` already bundles server.ts and
// everything it imports into a single self-contained dist/server.cjs (via
// esbuild --bundle) before Vercel processes /api -- importing that bundle
// directly here, instead of server.ts's TypeScript source, sidesteps a real
// failure mode already hit once: Vercel's own /api builder does per-file
// transpilation rather than full dependency bundling, so an
// `import app from "../server.ts"` compiled to plain JS but left the ".ts"
// specifier untouched, and the deployed function crashed at cold start with
// ERR_MODULE_NOT_FOUND because no such file existed at runtime.
//
// This has to stay a plain ESM ".js" file (package.json has "type": "module",
// and a ".cjs" file here isn't picked up as a Function entry point at all --
// both were tried and confirmed broken before landing on this).
import serverModule from "../dist/server.cjs";

// esbuild's CJS interop wraps a TS `export default app` as
// `{ __esModule: true, default: app }` -- unwrap it, since Vercel needs the
// actual Express app as the handler.
export default serverModule.default;
