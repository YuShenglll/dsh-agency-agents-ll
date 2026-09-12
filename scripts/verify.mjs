// Release gate for dsh-agency-agents-ll. Run with: pnpm verify
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
check('发布文件齐全', ['lib', 'assets', 'cordis.patch.yml', 'README.md', 'NOTICE', 'LICENSE']
  .every((entry) => packageJson.files?.includes(entry)))
check('导出 Host 与客户端入口', packageJson.exports?.['.'] !== undefined && packageJson.exports?.['./client'] !== undefined)

for (const file of ['../lib/index.js', '../lib/client.js', '../cordis.patch.yml', '../LICENSE', '../NOTICE']) {
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

const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
check('Cordis patch 挂载当前包名', patch.includes(`name: ${packageJson.name}`))

const plugin = await import(new URL('../lib/index.js', import.meta.url).href)
check('编译入口导出 DSH 插件约定', ['name', 'Config', 'apply'].every((key) => key in plugin))

const { resolvePromptLocale, coercePromptLocale } = await import(new URL('../lib/contract.js', import.meta.url).href)
check('auto 跟随宿主语言', resolvePromptLocale('auto', 'en') === 'en' && resolvePromptLocale('auto', 'zh') === 'zh')
check('显式偏好覆盖宿主语言', resolvePromptLocale('zh', 'en') === 'zh' && resolvePromptLocale('en', 'zh') === 'en')
check('未知取值回退默认', coercePromptLocale('fr') === 'en' && coercePromptLocale(undefined) === 'en')

if (failures > 0) {
  console.error(`\n${failures} 项验证失败`)
  process.exit(1)
}

console.log('\n全部发布验证通过')
