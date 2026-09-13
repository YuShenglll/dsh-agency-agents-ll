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
| D4 | 中文产物 | **一份中文简介**（`intro`）：这个专家是什么角色、擅长什么、什么时候该找他。**不要求**中文全文翻译 |
| D4b | 中文提示词 | **可选**。某个专家提供了中文正文时，切换到中文就用它；没提供就回退英文原文并如实标注。切换功能保留 |
| D5 | 名字 | **中文名，固定不切换**；唯一真源是中文文件的 frontmatter |
| D6 | 提示词切换 | 三态 `auto` / `zh` / `en`，`auto` 跟随 DSH 界面语言 |
| D7 | 默认提示词语言 | **英文** |
| D8 | 中文质量门禁 | 简介必填且字数入区间；全文译文（若提供）另过结构镜像门禁 |
| D9 | 客户端 UI | 名册浏览、搜索与筛选、启用停用、查看与复制提示词、自定义专家编辑器、输入框 `@` 触发。设置项名为「专家库」，输入栏按钮显示「专家」 |
| D10 | 头像 | 先用 frontmatter 里的 emoji，不引入额外素材 |
| D11 | 包名 / 仓库 | `dsh-agency-agents-ll` / https://github.com/YuShenglll/dsh-agency-agents-ll |
| D12 | 名册顺序 | **恒定按分区 + slug**。启用某个专家不移动任何一行 |
| D13 | 写入的并发模型 | 一次只跑一个写入，**按点击顺序排队**，每个写入在自己那一轮读取当前 revision |
| D14 | 忙碌范围 | 忙碌是**单张卡片**的：一张卡在写，其余 278 张照常可点。只有页头、筛选器和弹窗用页面级忙碌 |
| D15 | 失败不牵连整页 | 客户端半边包一层错误边界；渲染抛错就地显示一行可复制的报错，而不是让 `settings.section` 这个槽位条目被退役 |

## 3. 内容模型

名册总量 **279 个专家 / 18 个分区**，完全等于英文上游的正式分区集合。

| 产物 | 来源 | 维护方式 |
|---|---|---|
| `assets/en/<division>/<slug>.md` | 英文上游 | `sync/` 同步，逐字节校验，**不手改** |
| `assets/zh/<division>/<slug>.md` | 本项目 | 中文档案：`name` / `description` / **`intro`** / `emoji`，外加**可选**的正文 |

### 3.1 中文档案的两种形态

中文文件是这位专家的**中文档案**，正文是可选的一段：

| 形态 | 内容 | 召唤时的行为 |
|---|---|---|
| `intro-only`（默认） | 只有 frontmatter，无正文 | 名册显示中文；提示词用**英文原文** |
| `translated` | frontmatter + 中文正文 | 名册显示中文；切到中文时用**中文正文** |

`intro` 是本项目的**主要交付物**：3–5 句中文，讲清这个专家是什么角色、擅长什么、什么时候该找他。

写作约定（保持全库一致）：

- 以第二人称向读者介绍这位专家；用第三人称回指专家时统一用「他」，用「它」仅指代对象（语言、设备、工具、产物）。
- 不给专家起音译名，`name` 用中国人认得的岗位称谓。
- 不写「致力于提供高质量的服务」这类填充语；简介必须能让人判断「这件事该不该找他」。

全文翻译**不是必需**。有人愿意译就有中文提示词，没人译就回退英文——两种形态都是合法且完整的档案。

### 3.2 处理演进与新鲜度

中文档案的每一段都是英文派生的，必须能回答「哪一段对应的英文已经变了」。因此：

- 每个中文文件在 frontmatter 记录 `sourceSha256`：写入时所依据的英文文件的哈希（由 `sync/stamp.mjs` 从磁盘推导，不靠译者手填）。
- `sync/manifest.json` 记录上游 commit、每个英文文件的 sha256、每个中文档案的形态与新鲜度。
- 状态取值：`missing`（无中文档案）、`current`（哈希一致）、`stale`（英文已变）。
- **`stale` 的严重级别取决于形态**：带正文的全文译文过期是**硬失败**（旧中文人设配上新英文指令会误导被召唤的专家）；只有简介的档案过期只是**告警**（一段短简介的描述偏差，不该阻断发布）。

### 3.3 单一真源

| 字段 | 真源 |
|---|---|
| 中文名 | 中文文件 frontmatter 的 `name` |
| 中文简介 | 中文文件 frontmatter 的 `intro` |
| 英文名 | 英文文件 frontmatter 的 `name` |
| 分区 | 目录名；中文分区名在 `src/names.ts` 中集中维护（`sync/glossary.json` 的副本由 `verify` 门禁强制一致） |

不设额外的硬编码名称表 —— 名称只允许有一个家。

`resolveExpert` 同时接受中文名与英文名查询，否则模型无法用英文名召唤。

`describe_expert` 是 `intro` 的出口：按名字返回中文名、一句话简介、中文简介，以及是否提供中文提示词。

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

| 检查 | 抓什么问题 | 硬失败 |
|---|---|---|
| slug 集合一致性 | 英文树与中文树的分区、slug 集合差异 | 否 |
| frontmatter 合法性 | 中文档案缺 `name` / `description` / `intro` / `emoji`，引号或围栏未闭合 | **是** |
| `intro` 字数区间 | 简介缺失、过短（像占位）或过长（像贴了一整篇） | **是** |
| 英文与上游逐字节一致 | 传输损坏、转码错误、BOM | **是** |
| 翻译新鲜度 | `sourceSha256` 与当前英文不符；带正文时硬失败，仅简介时告警 | 视形态 |
| 段落级 EN↔ZH 对齐 | 中文正文漏译整节、多出无来源段落（**精确相等**，不是比例下限） | 否 |
| 标题层级对齐 | 中文正文的章节结构不一致 | 否 |
| 术语表一致性 | 正文里同一英文术语的译法不统一；**不施加于简介**（简介是摘要，无法容纳全文术语） | 否 |
| 长度比区间 | 正文中英字符比落在 `[0.7, 3.2]` 之外（实测分位数见 `checks.mjs` 注释） | 否 |
| 残留外文检测 | 中文正文里仍留有英文句子 | 否 |
| 代码块闭合 | 围栏未配对导致的正文截断 | **是** |

结构性检查（段落、标题、长度比、残留外文、术语表）**只施加于带正文的中文档案**；只有简介的档案没有正文可对齐，这些检查对它不适用。产出三堆：`aligned` / `suspect` / `missing`。

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
│  ├─ names.ts            18 个分区的中英显示名（分区名的唯一真源）
│  ├─ i18n.ts             Host 文案（zh 为 key 集真相源，en 用 satisfies 校验）
│  ├─ catalog.ts          扫描两棵树、解析 frontmatter、名称解析
│  ├─ persona.ts          按语言读取 persona 正文并回退
│  ├─ index.ts            Host：catalog + 4 个工具 + installSection
│  ├─ index.test.ts       vitest
│  ├─ roster-settings.ts  enabled 列表与自定义专家（settings 支撑，revision fencing）
│  ├─ expert-contract.ts  自定义专家的 zod 契约
│  ├─ remote.ts           Typert Remote 服务（浏览器读取名册的唯一通道）
│  ├─ remote-contract.ts  Host/Client 共用的方法描述符表
│  ├─ remote.test.ts      vitest
│  └─ client/             浏览器半边
│     ├─ index.ts         settings.section 页面 + conversation.input.left 触发器
│     ├─ locales.ts       客户端词条（zh 为 key 集真相源）
│     ├─ catalog.ts       客户端名册状态
│     └─ remote.ts        客户端 remote 调用
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
- **`dsh.client.inject` 是「必须先挂载的客户端模块」清单，不是类型清单。** 列进一个宿主没有的模块，会让浏览器半边**永不激活**。所以：
  - 列进去的每一项都必须是 `peerDependencies` 里的运行时依赖（`pnpm verify` 强制）。
  - 只为声明合并而引入的包（`import type {} from '...'`，编译后被擦除）放 `devDependencies`，**不列入 inject**。
  - 槽位依赖靠 `ctx.slots.inject('<slot>', ...)` 表达 —— 它等的是槽位声明，不是模块名。`conversation.input.left` 就属于这一类。

## 9. 阶段与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 骨架** | 工程、双端构建、cordis.patch、本地安装 | 已完成：`pnpm build` 产出两端产物；`pnpm verify` 通过；隔离 profile 的 `--dump-config` 看到层 |
| **P1 数据管线** | `sync.mjs` + `checks.mjs` + `glossary.json` + manifest | 已完成：manifest 覆盖 279；英文侧 279/279 逐字节对齐上游；连跑三次幂等 |
| **P2 中文档案** | 279 份中文名 + 一句话简介 + **中文简介** | 已完成：279/279 `aligned`，0 suspect，0 missing；6 份另带完整中文正文 |
| **P3 Host 功能** | catalog、4 个工具（`list_experts` / `describe_expert` / `summon_expert` / `summon_experts`）、语言解析 | 已完成：24 项 vitest 覆盖语言解析、名册合并、简介读取、名称解析、persona 回退与请求校验 |
| **P4 客户端** | 名册页、启用停用、简介展示、提示词查看复制、自定义专家编辑器、`@` 触发、Host Remote 服务 | 已完成：`--dump-config` 见主行与 remote 行；30 项 verify 通过；用户在浏览器验收 |
| **P5 发布** | 双语 README、tag | 只差打 tag |

各阶段的实测证据、尚未验证的路径与续工方式见 **[`STATUS.md`](STATUS.md)**。

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
| 中文与英文内容不对等（漏译/臆造） | 第 6 节的段落对齐与长度比检查，机器可查；简介另过字数与必填校验 |
| 上游演进导致中英脱节 | `sourceSha256` 新鲜度跟踪：带正文的过期是硬失败，仅简介的过期是告警 |
| 客户端 600KB 级 UI 工作量大 | 已落地为约 1.3k 行源码 + 245 KB 产物；P4 独立成阶段，未阻塞 P0–P3 |
| 客户端插件因 `dsh.client.inject` 列错模块而静默不激活 | 门禁强制 inject 的每一项都是 peerDependency；见第 8 节 |
| 渲染期抛错让整个设置页变白 | 槽位条目一旦抛错就被退役（`renderer.ts` 的 `reportEntryError`），刷新前不再回来。故：D15 的错误边界 + 贡献在 Remote 挂载**之后**才注册（挂载前渲染会因服务未就绪而抛错）+ D14 缩小每次重绘的范围 |
