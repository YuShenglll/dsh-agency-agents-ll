# dsh-agency-agents-ll — 实施规格

本文档是项目的**契约**。后续所有改动以本文档为准；偏离需先改本文档再改代码。

## 1. 目标

做一个独立的 DeepSeek Harness 插件，提供**中英双语**的 The Agency 专家名册，且**只切换专家提示词的语言**。

## 2. 锁定的决策

| 编号 | 决策 | 取值 |
|---|---|---|
| D1 | 内容来源 | **只有英文上游**：https://github.com/msitarzewski/agency-agents |
| D2 | 名册范围 | **英文上游有什么就收录什么**，不在英文上游的一律不收录，共 279 个专家 / 18 个分区 |
| D3 | 英文提示词 | 上游原文，**逐字节同步，不改写**，保证可重复同步 |
| D4 | 中文提示词 | **本项目自行翻译与精校**，不从任何第三方译文仓库同步 |
| D5 | 名字 | **中文名，固定不切换**；唯一真源是中文文件的 frontmatter |
| D6 | 提示词切换 | 三态 `auto` / `zh` / `en`，`auto` 跟随 DSH 界面语言 |
| D7 | 默认提示词语言 | **英文** |
| D8 | 中文质量门禁 | 机械检查筛出 `aligned` / `suspect` / `missing` 三堆，只对 `suspect` 逐字精校 |
| D9 | 客户端 UI | 名册浏览、搜索与筛选、启用停用、查看与复制提示词、自定义专家编辑器、输入框 `@` 触发 |
| D10 | 头像 | 先用 frontmatter 里的 emoji，不引入额外素材 |
| D11 | 包名 / 仓库 | `dsh-agency-agents-ll` / https://github.com/YuShenglll/dsh-agency-agents-ll |

## 3. 内容模型

名册总量 **279 个专家 / 18 个分区**，完全等于英文上游的正式分区集合。

| 产物 | 来源 | 维护方式 |
|---|---|---|
| `assets/en/<division>/<slug>.md` | 英文上游 | `sync/` 同步，逐字节校验，**不手改** |
| `assets/zh/<division>/<slug>.md` | 本项目翻译 | 人工/翻译产出，**按源文件哈希跟踪新鲜度** |

### 3.1 翻译新鲜度

中文是派生产物，必须能回答「哪一份中文对应的英文已经变了」。因此：

- 每个中文文件在 frontmatter 记录 `sourceSha256`：它翻译时所依据的英文文件的哈希。
- `sync/manifest.json` 记录上游 commit、每个英文文件的 sha256、每个中文文件的翻译状态。
- 状态取值：`missing`（未翻译）、`current`（哈希一致）、`stale`（英文已变，需重译）。

`checks.mjs` 把 `stale` 视为失败，因此「上游改了英文但中文没跟上」不会静默漏掉。

### 3.2 单一真源

| 字段 | 真源 |
|---|---|
| 中文名 | 中文文件 frontmatter 的 `name` |
| 英文名 | 英文文件 frontmatter 的 `name` |
| 分区 | 目录名；中文分区名在 `src/names.ts` 中集中维护 |

不设额外的硬编码名称表 —— 名称只允许有一个家。

`resolveExpert` 同时接受中文名与英文名查询，否则模型无法用英文名召唤。

## 4. 许可

| 内容 | 许可 |
|---|---|
| 英文 persona（上游） | MIT，`assets/en/LICENSE` 保留上游原文 |
| 中文 persona（本项目翻译） | 上游 MIT 的演绎作品，`assets/zh/LICENSE` 同样保留上游 MIT 原文 |
| 本项目源码、构建脚本、文档 | Apache-2.0 |

`NOTICE` 说明三段授权边界与上游署名。`sync/manifest.json` 记录同步基线。

## 5. 语言解析

```
effective = preference === 'auto' ? hostLocale : preference
```

- `preference` 来自本插件设置命名空间 `agency-agents-ll` 的 `promptLocale`。
- `hostLocale` 来自 DSH 的 `locale.preference`。
- 名册的**名字**不参与解析，永远显示中文。

## 6. 机械质量门禁

`sync/checks.mjs` 对每个文件跑下列检查，输出三堆清单。

| 检查 | 抓什么问题 |
|---|---|
| slug 集合一致性 | 英文树与中文树的分区、slug 集合差异 |
| frontmatter 合法性 | 缺 `name` / `description` / `emoji`，引号未闭合 |
| 英文与上游逐字节一致 | 传输损坏、转码错误、BOM |
| 翻译新鲜度 | `sourceSha256` 与当前英文文件不符 → `stale` |
| 段落级 EN↔ZH 对齐 | 中文漏译整节、多出无来源段落、顺序错乱 |
| 标题层级对齐 | 章节结构不一致 |
| 术语表一致性 | 同一英文术语的译法在全库不统一 |
| 长度比区间 | 中英字符比异常 → 疑似过简、漏译或臆造 |
| 残留外文检测 | 中文正文里仍留有英文句子 |
| 代码块闭合 | 围栏未配对导致的正文截断 |

只有 `suspect` 堆需要逐字精校；`aligned` 堆抽样复核。这既是质量手段，也是可回归的 CI 门禁。

## 7. 工程结构

```
dsh-agency-agents-ll/
├─ sync/
│  ├─ sync.mjs            拉英文上游 → 归一化分区/slug → 写 assets/en + manifest
│  ├─ checks.mjs          第 6 节的机械门禁
│  ├─ glossary.json       术语表（中英对照，精校的一致性依据）
│  └─ manifest.json       上游 commit + 逐文件 sha256 + 翻译状态
├─ assets/
│  ├─ en/<division>/<slug>.md
│  ├─ en/LICENSE          上游 MIT 原文
│  ├─ zh/<division>/<slug>.md
│  └─ zh/LICENSE          上游 MIT 原文
├─ src/
│  ├─ contract.ts         两端共享常量与纯函数（不得引入 Host 依赖）
│  ├─ names.ts            18 个分区的中英显示名
│  ├─ i18n.ts             Host 文案（zh 为 key 集真相源，en 用 satisfies 校验）
│  ├─ catalog.ts          扫描两棵树、解析 frontmatter、名称解析
│  ├─ persona.ts          按语言读取 persona 正文并回退
│  ├─ index.ts            Host：catalog + 三个工具 + installSection
│  ├─ index.test.ts       vitest
│  └─ client/index.ts     浏览器：settings.section 页面 + conversation.input.left 触发器
├─ cordis.patch.yml
├─ tsdown.config.ts
├─ scripts/verify.mjs
└─ package.json
```

`lib/index.js` 只允许把 `@deepseek-ai/dsh-tools` 与 `@deepseek-ai/schemastery` 作为外部依赖引用；其余 DSH 包必须同时出现在 `peerDependencies` 里，否则 tsdown 会把它们内联成第二份实现。

## 8. DSH 装载机制（已核对 harness 源码）

- 插件导出 `name` / `Config` / `apply(ctx, config)`；注册走 `ctx.effect()`。
- `package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml`；profile 列出的 bundle 层按顺序叠加。
- 装载顺序：`@deepseek-ai/dsh-base` → profile 的 `bundles` → profile 的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch`。后层按行覆盖，**patch 替换整行 config，不深合并**。
- 客户端半边由客户端模块系统按 `dsh.client` 扫描并注入页面，**不需要重建 Web 应用**。
- 客户端产物必须是 `window.__ModuleLoader__.load({ id, factory })` 包装的 CJS，平台冻结模块保持 external（`react` / `react-dom` / `@deepseek-ai/cordis` / `ui-slots` / `ui-primitives` / `client-web-react` / `schema-input` / `ui-attachment`）。
- 设置页由插件自己的客户端注册到 `settings.section`（独立导航页）或 `settings.plugin.item`（插件配置卡片）。
- 本地安装：`dsh plugin --profile desktop add ./dsh-agency-agents-ll`。

## 9. 阶段与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 骨架** | 工程、双端构建、cordis.patch、本地安装 | 已完成：`pnpm build` 产出两端产物；`pnpm verify` 通过；隔离 profile 的 `--dump-config` 看到层 |
| **P1 数据管线** | `sync.mjs` + `checks.mjs` + `glossary.json` + manifest | manifest 覆盖 279；英文侧逐字节对齐；产出 `aligned`/`suspect`/`missing` 清单 |
| **P2 内容** | 279 份中文翻译与精校，分批推进 | 每批出 diff + 校验报告，可回滚；最终 `missing` 与 `stale` 归零 |
| **P3 Host 功能** | catalog、3 个工具、语言解析 | vitest 覆盖语言解析、回退、名称解析 |
| **P4 客户端** | 名册页、启用停用、提示词查看复制、自定义专家编辑器、`@` 触发 | Playwright 冒烟 + 双语词条 key 对齐 |
| **P5 发布** | verify 门禁扩充、双语 README、tag | `pnpm verify` 通过 |

## 10. 环境

`node` 与 `npm` 不在 PATH。构建链通过 DSH Desktop 自带的 runtime shim：

```
C:\Users\LL\AppData\Roaming\DSH Desktop\runtime-commands\generations\<hash>\private\node-bin\node.cmd   # Node v24.18.1
C:\Users\LL\AppData\Roaming\DSH Desktop\runtime-commands\generations\<hash>\bin\pnpm.cmd                # pnpm 11.8.0
```

该 `<hash>` 会随 DSH 升级变化，脚本中不要硬编码，用 `Get-Command pnpm` 解析。

## 11. 风险

| 风险 | 处置 |
|---|---|
| 279 份中文全部自产，工作量大 | 分批推进；机械门禁先把范围收敛到 `suspect` 堆 |
| 中文与英文内容不对等（漏译/臆造） | 第 6 节的段落对齐与长度比检查，机器可查 |
| 上游演进导致中英脱节 | `sourceSha256` 新鲜度跟踪，`stale` 即 CI 失败 |
| 客户端 UI 工作量大 | P4 独立成阶段，P0–P3 不阻塞 |
