// Release gate for dsh-agency-agents-ll. Run with: pnpm verify
import { existsSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'

let failures = 0

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`通过：${label}`)
    return
  }
  failures += 1
  console.error(`失败：${label}${detail === '' ? '' : `（${detail}）`}`)
}

const packageUrl = new URL('../package.json', import.meta.url)
const packageJson = JSON.parse(await readFile(packageUrl, 'utf8'))

check('包名与仓库一致', packageJson.name === 'dsh-agency-agents-ll', packageJson.name)
check('许可证为 Apache-2.0', packageJson.license === 'Apache-2.0')
check('声明 dsh.bundle.patch', packageJson.dsh?.bundle?.patch === './cordis.patch.yml')
check(
  '声明客户端半边',
  packageJson.dsh?.client?.platform === 'web' && Array.isArray(packageJson.dsh?.client?.inject),
)
// `dsh.client.inject` names the client modules that must be mounted before this
// one, so listing a module the host does not ship would leave the browser half
// permanently inactive. A package needed only for a type merge (an erased
// `import type {}`) belongs in devDependencies and must NOT be listed here.
const injected = packageJson.dsh?.client?.inject ?? []
const notPeer = injected.filter((name) => packageJson.peerDependencies?.[name] === undefined)
check(
  'dsh.client.inject 的每一项都声明为 peerDependency',
  injected.length > 0 && notPeer.length === 0,
  notPeer.join(', '),
)
check('发布文件齐全', ['lib', 'assets', 'cordis.patch.yml', 'README.md', 'NOTICE', 'LICENSE']
  .every((entry) => packageJson.files?.includes(entry)))
check('导出 Host 与客户端入口', packageJson.exports?.['.'] !== undefined && packageJson.exports?.['./client'] !== undefined)
check('导出 Remote 入口', packageJson.exports?.['./remote'] !== undefined && packageJson.exports?.['./remote']?.default === './lib/remote.js')

for (const file of ['../lib/index.js', '../lib/client.js', '../lib/remote.js', '../cordis.patch.yml', '../LICENSE', '../NOTICE']) {
  try {
    await access(new URL(file, import.meta.url))
    check(`发布文件存在：${file.slice(3)}`, true)
  } catch {
    check(`发布文件存在：${file.slice(3)}`, false)
  }
}

const clientBundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
check(
  '客户端产物带 ModuleLoader 工厂包装',
  clientBundle.includes('window.__ModuleLoader__.load(') && clientBundle.includes('dsh-agency-agents-ll'),
)
check('客户端产物不引用 Node url 模块', !clientBundle.includes('require("url")') && !clientBundle.includes("require('url')"))
// The platform-frozen table must stay external, otherwise the browser gets a
// second React/cordis instance instead of the host's.
const PLATFORM_MODULES = [
  'react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]
const bundleRequires = [...clientBundle.matchAll(/require\((["'])([^"']+)\1\)/g)].map((match) => match[2])
check(
  '客户端产物把平台冻结模块保持为 external',
  bundleRequires.every((id) => PLATFORM_MODULES.includes(id)),
  [...new Set(bundleRequires)].join(', '),
)
check(
  '客户端产物外部引用 react 而不是内联它',
  bundleRequires.includes('react') && !clientBundle.includes('__SECRET_INTERNALS'),
)
check(
  '客户端产物不引用 Node 内置模块',
  !bundleRequires.some((id) => id.startsWith('node:')),
  [...new Set(bundleRequires.filter((id) => id.startsWith('node:')))].join(', '),
)

const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
check('Cordis patch 挂载当前包名', patch.includes(`name: ${packageJson.name}`))
// The Remote half is its own top-level row: the gateway discovers Remote routes
// from the root service table, so a service provided inside another plugin's
// fiber would never be routable from the browser.
check('Cordis patch 挂载 Remote 行', patch.includes(`name: ${packageJson.name}/remote`))

const plugin = await import(new URL('../lib/index.js', import.meta.url).href)
check('编译入口导出 DSH 插件约定', ['name', 'Config', 'apply'].every((key) => key in plugin))

const remoteEntry = await import(new URL('../lib/remote.js', import.meta.url).href)
check('Remote 入口导出 Typert 服务类', typeof remoteEntry.default === 'function')
check(
  'Remote 入口导出与客户端共用的描述符表',
  Array.isArray(remoteEntry.AGENCY_AGENTS_DESCRIPTORS) && remoteEntry.AGENCY_AGENTS_DESCRIPTORS.length > 0,
)

const { resolvePromptLocale, coercePromptLocale } = await import(new URL('../lib/contract.js', import.meta.url).href)
check('auto 跟随宿主语言', resolvePromptLocale('auto', 'en') === 'en' && resolvePromptLocale('auto', 'zh') === 'zh')
check('显式偏好覆盖宿主语言', resolvePromptLocale('zh', 'en') === 'zh' && resolvePromptLocale('en', 'zh') === 'en')
check('未知取值回退默认', coercePromptLocale('fr') === 'en' && coercePromptLocale(undefined) === 'en')

// Division display names have exactly one home: src/names.ts. The sync glossary
// repeats them for translators, so a drift between the two is a gate failure
// rather than something a reviewer has to notice.
const { ZH_DIVISION, EN_DIVISION, DIVISIONS } = await import(new URL('../lib/names.js', import.meta.url).href)
const glossary = JSON.parse(await readFile(new URL('../sync/glossary.json', import.meta.url), 'utf8'))
const glossaryDivisions = Object.entries(glossary.terms ?? {})
  .filter(([key]) => key.startsWith('division:'))
  .map(([key, value]) => [key.slice('division:'.length), value])
check('分区数量为 18', DIVISIONS.length === 18, String(DIVISIONS.length))
check(
  '中英分区显示名一一对应',
  DIVISIONS.every((division) => ZH_DIVISION[division] !== undefined && EN_DIVISION[division] !== undefined),
)
check(
  'sync 术语表的分区名与 src/names.ts 一致',
  glossaryDivisions.length === DIVISIONS.length
    && glossaryDivisions.every(([division, value]) => ZH_DIVISION[division] === value),
  glossaryDivisions.filter(([division, value]) => ZH_DIVISION[division] !== value).map(([division]) => division).join(', '),
)

// The avatar brief hands out one filename per expert, so it is only usable
// while it names exactly the current roster. Regenerate with `pnpm avatars`.
const { roster } = await import('./avatar-manifest.mjs')
const avatarBrief = await readFile(new URL('../docs/AVATARS.md', import.meta.url), 'utf8')
const slugs = roster().map((row) => row.slug)
const briefSlugs = [...avatarBrief.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((match) => match[1])
check(
  `docs/AVATARS.md 逐条对应名册（${slugs.length} 个专家）`,
  briefSlugs.length === slugs.length && briefSlugs.every((slug, index) => slug === slugs[index]),
  `清单 ${briefSlugs.length} 条，名册 ${slugs.length} 条；先跑 pnpm avatars`,
)

// The generated client module is ignored by git and lives only where the
// avatar tree does, so these gates have to hold in both worlds. Regenerating in
// memory and comparing is what makes that one statement instead of two: with a
// tree present it proves the module matches, and with none it proves the module
// is the empty map that a clean checkout produces.
const { render: renderAvatars } = await import('./avatars-inline.mjs')
const inlined = await readFile(new URL('../src/client/avatars.ts', import.meta.url), 'utf8')
check('src/client/avatars.ts 与 assets/avatar 一致', inlined === renderAvatars(), '先跑 pnpm avatars:inline')
const inlinedSlugs = [...inlined.matchAll(/^ {2}'([a-z0-9-]+)': 'data:image\/svg\+xml,/gm)].map((match) => match[1])
const strayAvatars = inlinedSlugs.filter((slug) => !slugs.includes(slug))
check(
  `每张头像都对应名册里的专家（${inlinedSlugs.length} 张）`,
  strayAvatars.length === 0,
  strayAvatars.slice(0, 5).join(', '),
)
const expectedAvatars = existsSync(new URL('../assets/avatar', import.meta.url)) ? slugs.length : 0
check(
  `头像数量与本地素材树相符（${inlinedSlugs.length} / ${expectedAvatars}）`,
  inlinedSlugs.length === expectedAvatars,
  expectedAvatars === 0
    ? '本机没有 assets/avatar，生成的应当是空模块'
    : `${expectedAvatars - inlinedSlugs.length} 个专家没有头像，会回退 emoji`,
)

if (failures > 0) {
  console.error(`\n${failures} 项验证失败`)
  process.exit(1)
}

console.log('\n全部发布验证通过')
