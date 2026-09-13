import ts from 'typescript'
import { defineConfig } from 'vitest/config'

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/**
 * Lower standard (stage-3) decorators before esbuild parses the file — the
 * test-side twin of the plugin in `tsdown.config.ts`.
 *
 * `src/remote.ts` decorates its methods with `@Remote('getCatalog')`, which
 * esbuild does not parse; `tsc.transpileModule` rewrites it into `__esDecorate`
 * calls. Without this the Remote tests could not import the Host service at
 * all, and with a different transform they would test a different artifact than
 * the one that ships.
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
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  test: {
    include: ['src/**/*.test.ts'],
    // `src/client/index.ts` imports the generated avatar module statically, and
    // that module is not committed. Generate it here so a bare `vitest run`
    // works, not only `pnpm test`.
    globalSetup: ['./scripts/vitest-avatars.mjs'],
  },
})
