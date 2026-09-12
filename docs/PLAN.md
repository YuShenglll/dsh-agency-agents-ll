# dsh-agency-agents-ll — 实施规格

本文档是项目的**契约**。后续所有改动以本文档为准；偏离需先改本文档再改代码。

## 1. 目标

做一个**独立**的 DeepSeek Harness 插件，提供中英双语的 The Agency 专家名册，且**只切换专家提示词的语言**。

不修改 `MichengAI/dsh-agency-agents` 的任何源码；本项目是重新实现。

## 2. 锁定的决策

| 编号 | 决策 | 取值 |
|---|---|---|
| D1 | 双语覆盖 | **全量双语**：并集 328 个专家，英文与中文提示词都要有 |
| D2 | 名字是否切换 | **不切换**。名册显示**中文名**，固定 |
| D3 | 提示词是否切换 | **切换**。这是本插件相对原插件的核心差异 |
| D4 | 默认提示词语言 | **英文**，需要时切中文 |
| D5 | 切换开关形态 | 三态 `auto` / `zh` / `en`，`auto` 跟随 DSH 界面语言 |
| D6 | 英文正文的「精校」口径 | **机械完整性校验，不改写上游文案**（保证可重复同步） |
| D7 | 中文正文的「精校」口径 | 先用机械检查缩小范围，再对异常件人工精校 |
| D8 | 客户端 UI | **对齐原插件全部功能**（名册浏览/搜索/筛选/启用停用/查看复制提示词/自定义专家编辑器/`@` 触发） |
| D9 | 头像 | P0–P4 不做，用 frontmatter 的 emoji 占位 |
| D10 | 与原插件共存 | 不共存。用户自行卸载原插件，本项目可用同名工具 |
| D11 | 包名 / 仓库 | `dsh-agency-agents-ll` / https://github.com/YuShenglll/dsh-agency-agents-ll |

## 3. 内容图谱（实测）

| 集合 | 数量 | 说明 |
|---|---|---|
| 英文上游 `msitarzewski/agency-agents` | 279 | 18 个正式分区（`divisions.json`） |
| 中文上游 `jnMetaCode/agency-agents-zh` | 277 | 24 个分区，含 `company` / `hr` / `legal` / `supply-chain` |
| 两边都有 | 228 | 现成双语对，**不需要翻译**，只需精校 |
| 只在英文上游 | 51 | 需要中文正文 |
| 只在中文上游 | 49 | 需要英文正文 |
| **并集** | **328** | 本插件的名册总量 |

推导出的、必须记住的两条事实：

1. 原插件 `@michengai/dsh-agency-agents` 的 48 个「插件独有」 agent **全部来自中文上游**，没有一个是原创内容。因此它们同样是 MIT 资产，可以合法收录。
2. 原插件里有 **45 份中文是通用样板正文**，而这 45 个 slug 恰好**逐条等于**中文上游未覆盖的集合。即原插件的同步管线在中文上游没有对应文件时，塞模板顶数。本项目不能重复这个做法。

## 4. 上游与许可

| 上游 | 许可 | 同步目标 |
|---|---|---|
| `https://github.com/msitarzewski/agency-agents` | MIT（`assets/en/LICENSE`） | `assets/en/<division>/<slug>.md` |
| `https://github.com/jnMetaCode/agency-agents-zh` | MIT（`assets/zh/LICENSE`） | `assets/zh/<division>/<slug>.md` |

本项目自身的源码、构建脚本与文档采用 Apache-2.0。`NOTICE` 必须保留两个上游的署名。
`sync/manifest.json` 记录同步时的上游 commit 与逐文件 sha256，作为可追溯凭据。

## 5. 数据模型

每个专家由三部分组成：

| 字段 | 来源 | 是否随语言切换 |
|---|---|---|
| `name` | 中文树的 frontmatter `name` | **否**（固定中文） |
| `promptEn` | 英文树正文 | 是 |
| `promptZh` | 中文树正文 | 是 |

**中文名只有一个真源：中文文件的 frontmatter。** 不设硬编码名称表 —— 原插件正是因为这个双真源，导致 145 处中文名互相矛盾。

`resolveExpert` 仍同时接受中文名与英文名查询，否则模型无法用英文名召唤。

## 6. 语言解析

```
effective = preference === 'auto' ? hostLocale : preference
```

- `preference` 来自本插件设置命名空间 `agency-agents-ll` 的 `promptLocale`。
- `hostLocale` 来自 DSH 的 `locale.preference`。
- 名册的**名字**不参与这个解析，永远显示中文。

## 7. 机械质量门禁（中文精校的筛选器）

`sync/` 产出的每个文件都要过这些检查，输出三堆：`aligned` / `suspect` / `missing`。

| 检查 | 抓什么问题 |
|---|---|
| slug 集合一致性 | 英文树与中文树的分区、slug 集合差异 |
| frontmatter 合法性 | 缺 `name` / `description` / `emoji`，引号未闭合 |
| 与上游逐字节一致（英文） | 传输损坏、转码错误、BOM |
| 段落级 EN↔ZH 对齐 | 中文漏译一整节、多出无来源段落、顺序错乱 |
| 标题层级对齐 | 章节结构不一致 |
| 术语表一致性 | 同一英文术语的译法在全库不统一 |
| 长度比区间 | 中文/英文字符比异常 → 疑似过简、漏译或臆造 |
| 残留外文检测 | 中文正文里仍留有英文句子 |
| 代码块闭合 | 围栏未配对导致的正文截断 |

只有 `suspect` 堆需要逐字精校；`aligned` 堆抽样复核即可。这既是质量手段，也是**可回归**的 CI 门禁。

## 8. 工程结构

```
dsh-agency-agents-ll/
├─ sync/
│  ├─ sync.mjs            拉两个上游 → 归一化分区/slug → 写 assets + manifest
│  ├─ checks.mjs          第 7 节的机械门禁
│  └─ manifest.json       上游 commit + 逐文件 sha256 + 翻译状态
├─ assets/
│  ├─ en/<division>/<slug>.md
│  ├─ zh/<division>/<slug>.md
│  ├─ en/LICENSE          上游 MIT 原文
│  └─ zh/LICENSE          上游 MIT 原文
├─ src/
│  ├─ contract.ts         两端共享常量与纯函数（不得引入 Host 依赖）
│  ├─ index.ts            Host：catalog + 工具 + installSection
│  └─ client/index.ts     浏览器：settings.section 页面 + conversation.input.left 触发器
├─ cordis.patch.yml
├─ tsdown.config.ts
├─ scripts/verify.mjs
└─ package.json
```

## 9. DSH 装载机制（已核对 harness 源码）

- 插件导出 `name` / `Config` / `apply(ctx, config)`；注册走 `ctx.effect()`。
- `package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml`；profile 列出的 bundle 层按顺序叠加。
- 装载顺序：`@deepseek-ai/dsh-base` → profile 的 `bundles` → profile 的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch`。后层按行覆盖，**patch 替换整行 config，不深合并**。
- 客户端半边由客户端模块系统按 `dsh.client` 扫描并注入页面，**不需要重建 Web 应用**。
- 客户端产物必须是 `window.__ModuleLoader__.load({ id, factory })` 包装的 CJS，平台冻结模块保持 external（`react` / `react-dom` / `@deepseek-ai/cordis` / `ui-slots` / `ui-primitives` / `client-web-react` / `schema-input` / `ui-attachment`）。
- 设置页由插件自己的客户端注册到 `settings.section`（独立导航页）或 `settings.plugin.item`（插件配置卡片）。
- 本地安装：`dsh plugin --profile desktop add ./dsh-agency-agents-ll`。

## 10. 阶段与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 骨架** | 工程、双端构建、cordis.patch、本地安装 | `pnpm build` 产出 `lib/index.js` + `lib/client.js`；`--dump-config` 看到层；设置里出现命名空间 |
| **P1 数据管线** | `sync.mjs` + `checks.mjs` + manifest | manifest 覆盖 328；机械检查全绿；产出 `aligned`/`suspect`/`missing` 三份清单 |
| **P2 内容** | 2a：100 份新翻译（51 英→中，49 中→英）；2b：228 对精校 | 每批出 diff + 校验报告，可回滚 |
| **P3 Host 功能** | catalog、3 个工具、语言解析、中文名唯一真源 | vitest 覆盖语言解析、回退、名称解析 |
| **P4 客户端对齐** | 名册页、启用停用、提示词查看复制、自定义专家编辑器、`@` 触发 | Playwright 冒烟 + 双语词条 key 对齐 |
| **P5 发布** | verify 门禁、双语 README、NOTICE、tag | `pnpm verify` 通过 |

## 11. 环境

`node` 与 `npm` 不在 PATH。构建链通过 DSH Desktop 自带的 runtime shim：

```
C:\Users\LL\AppData\Roaming\DSH Desktop\runtime-commands\generations\<hash>\private\node-bin\node.cmd   # Node v24.18.1
C:\Users\LL\AppData\Roaming\DSH Desktop\runtime-commands\generations\<hash>\bin\pnpm.cmd                # pnpm 11.8.0
```

该 `<hash>` 会随 DSH 升级变化，脚本中不要硬编码，用 `Get-Command pnpm` 解析。

## 12. 风险

| 风险 | 处置 |
|---|---|
| 中文翻译质量不足以支撑提示词效果 | D6/D7 的口径 + 第 7 节门禁；`suspect` 堆逐字精校 |
| 上游继续演进导致 discord | manifest 记录 commit 与 hash；英文侧不改写，保证能干净重同步 |
| 客户端 600KB 级 UI 工作量大 | P4 独立成阶段，P0–P3 不阻塞 |
| 与原插件同时安装导致工具名冲突 | D10：用户卸载原插件 |
