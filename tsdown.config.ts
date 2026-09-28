import type { UserConfig } from 'tsdown'
import ts from 'typescript'

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/**
 * Lower standard (stage-3) decorators before esbuild parses the file.
 *
 * `@Remote('getCatalog')` on the Host service is stage-3 syntax; esbuild in
 * tsdown's default pipeline does not understand it, so `tsc.transpileModule`
 * rewrites it into `__esDecorate` calls first. The vitest side carries the same
 * plugin in `vitest.config.ts`, otherwise the tests would exercise a different
 * compilation than the published artifact.
 * @returns the pre-enforced Vite plugin.
 */
function standardDecoratorPlugin() {
  return {
    name: 'standard-decorators',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, sourceMap: true },
      })
      return { code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'), map: result.sourceMapText }
    },
  }
}

/**
 * Two build faces:
 * - `node`   — the Host half, plain ESM for Node. `contract` and `names` are
 *   separate entries because they are the modules both faces share.
 * - `client` — the browser half. The client module system loads a package's
 *   `./client` export as a lazy-CJS factory, so the bundle must carry the
 *   `window.__ModuleLoader__.load({ id, factory })` banner. Platform-frozen
 *   modules stay external; everything else is inlined.
 *
 * The frozen module table mirrors the harness client platform seed
 * (`packages/client/web/src/platform.ts`, observed in the 0.1.7 web shell's
 * `staticModules` table). It must match exactly: a module the shell does not
 * seed but this list freezes would miss the browser module table at require
 * time, and a seeded module this list omits would be inlined as a second copy
 * of something the shell already owns.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

const ID = 'dsh-agency-agents-ll'

const node: UserConfig = {
  name: ID,
  entry: { index: 'src/index.ts', contract: 'src/contract.ts', names: 'src/names.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  plugins: [standardDecoratorPlugin()],
  dts: true,
  fixedExtension: false,
  clean: true,
}

const client: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  clean: false,
  deps: {
    neverBundle: [...PLATFORM_MODULES],
    alwaysBundle: (id: string) => !(PLATFORM_MODULES as readonly string[]).includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [node, client]
