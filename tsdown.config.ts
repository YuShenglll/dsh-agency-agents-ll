import type { UserConfig } from 'tsdown'

/**
 * Two build faces:
 * - `node`   — the Host half, plain ESM for Node.
 * - `client` — the browser half. The client module system loads a package's
 *   `./client` export as a lazy-CJS factory, so the bundle must carry the
 *   `window.__ModuleLoader__.load({ id, factory })` banner. Platform-frozen
 *   modules stay external; everything else is inlined.
 *
 * The frozen module table mirrors the harness client platform
 * (`packages/client/web/src/platform.ts`).
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

const ID = 'dsh-agency-agents-ll'

const node: UserConfig = {
  name: ID,
  entry: { index: 'src/index.ts', contract: 'src/contract.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
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
