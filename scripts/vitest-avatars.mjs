/**
 * Make `src/client/avatars.ts` exist before any spec imports it.
 *
 * The module is generated rather than committed, because the avatar tree it
 * comes from is kept off the repository. Vitest's own entry point has to
 * produce it too: `pnpm test` runs the generator first, but a direct
 * `pnpm exec vitest run` would otherwise fail to resolve the static import in
 * `src/client/index.ts`.
 */
import { generate } from './avatars-inline.mjs'

export function setup() {
  generate()
}
