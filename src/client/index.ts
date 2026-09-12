/**
 * Browser half of the plugin.
 *
 * P0 scaffold: this exists to prove the client bundle format builds — the
 * `window.__ModuleLoader__.load({ id, factory })` wrapper and the
 * platform-frozen `react` external are the two parts a package outside the
 * harness repository has to reproduce itself. The real settings card (roster
 * browser, expert enable/disable, prompt viewer, composer trigger) lands in P4
 * and registers into the `settings.section` slot.
 */
import React from 'react'

export const inject: string[] = []

/**
 * Mount the browser half.
 * @returns nothing; the P0 scaffold contributes no slots.
 */
export function apply(): void {
  // Keep the React external referenced so the bundle proves the frozen table resolves.
  void React
}
