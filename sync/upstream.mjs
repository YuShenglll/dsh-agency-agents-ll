// P1 data pipeline - the one command for "the upstream roster moved, bring me up
// to date and tell me what is left to write".
//
// Steps, in order:
//   1  sync --pull   fetch + fast-forward the checkout, then copy new and changed
//                    English personas into assets/en and refresh the manifest
//   2  authoring     name the Chinese profiles and avatars that are now missing
//   3  check         the twelve machine gates
//
// This is a driver rather than a `&&` chain in package.json for two reasons. The
// authoring step exits non-zero precisely when there IS work to do, so chaining
// would stop the gates from ever running after a normal upstream update; and a
// shell chain would need different syntax on Windows, where these scripts are
// actually run.
//
// Exits non-zero when the sync failed, a gate failed, or authoring is required --
// the last of which is a request for a human, not a tool failure.
//
// Run with: pnpm sync:upstream   (node is not on PATH in this environment)

import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const reportPath = path.join(projectRoot, 'sync', 'authoring.json')

const STEPS = [
  { title: '1/3  拉取上游并同步英文资产', script: 'sync/sync.mjs', args: ['--pull'], fatal: true },
  { title: '2/3  列出还需要人工补写的内容', script: 'sync/authoring.mjs', args: [], fatal: false },
  { title: '3/3  机械门禁', script: 'sync/checks.mjs', args: [], fatal: false },
]

const startedAt = Date.now()
const line = (text) => process.stdout.write(`${text}\n`)
const results = []

for (const step of STEPS) {
  line('')
  line(`=== ${step.title} ${'='.repeat(Math.max(0, 56 - step.title.length))}`)
  line('')
  const result = spawnSync(process.execPath, [path.join(projectRoot, step.script), ...step.args], {
    cwd: projectRoot,
    stdio: 'inherit',
  })
  const code = result.status === null ? 1 : result.status
  results.push({ ...step, code })
  if (step.fatal && code !== 0) {
    line('')
    line(`${step.script} 失败（exit ${code}），后面的步骤已跳过。`)
    process.exit(1)
  }
}

// Did the authoring step actually refresh its report, or die before writing one?
// The exit code alone cannot say, because a non-zero exit is also exactly how it
// reports "there is work to do".
let todo = null
try {
  if (statSync(reportPath).mtimeMs >= startedAt) {
    const parsed = JSON.parse(readFileSync(reportPath, 'utf8'))
    if (typeof parsed?.totals?.todo === 'number') todo = parsed.totals.todo
  }
} catch {
  todo = null
}

const [sync, authoring, gates] = results

line('')
line('汇总')
line(`  同步      ${sync.code === 0 ? 'ok' : `失败 exit ${sync.code}`}`)
line(`  待办      ${todo === null ? `报告未生成（authoring exit ${authoring.code}）` : `${todo} 项`}`)
line(`  门禁      ${gates.code === 0 ? 'ok' : `失败 exit ${gates.code}`}`)

if (todo !== null && todo > 0) {
  line('')
  line('上游有变动，需要人工补写。详单：pnpm authoring，或看 sync/authoring.json。')
  line('纯机械的后续：pnpm sync:stamp -> pnpm avatars -> pnpm avatars:inline -> pnpm build。')
}

process.exit(sync.code === 0 && authoring.code === 0 && gates.code === 0 ? 0 : 1)
