# dsh-agency-agents-ll

DeepSeek Harness 的**中英双语** The Agency 专家名册插件 —— 专家名与简介是中文，提示词可切换语言。

Bilingual (English/Chinese) Agency expert roster for DeepSeek Harness. Expert names and introductions are Chinese; the persona prompt switches language.

> 状态：**P0–P6 完成并已在 DSH 上运行**，279 位专家的中英文档案与 279 张专属头像全部通过机械门禁。各阶段的实测证据、尚未验证的路径与环境要点见 [`docs/STATUS.md`](docs/STATUS.md)。

## 它做什么

- 收录 **279 位专家 / 18 个分区**：学术、设计、工程、金融、游戏开发、地理信息、医疗健康、市场营销、付费媒体、产品、项目管理、研究、销售、安全、空间计算、专业、支持、测试。分区名的唯一真源是 [`src/names.ts`](src/names.ts)。
- 每位专家有一份**中文档案**：中文名、一句话简介，以及一段**中文简介**——讲清这个专家是什么角色、擅长什么、什么时候该找他、交付什么。
- 每位专家有一张**专属头像**（279 张 AI 生成、项目自有的贴纸风格 SVG，规格与清单见 [`docs/AVATARS.md`](docs/AVATARS.md)），在名册卡片上按素材原尺寸显示。
  **素材本身不进 git 仓库**，只保留在本地：`assets/avatar/` 与由它生成的 `src/client/avatars.ts` 都在 `.gitignore` 里。干净检出没有它们，构建照常通过，所有卡片回退显示 emoji。
- 专家**名称与简介固定中文**，不随提示词语言变化。
- 召唤专家时，persona 正文默认用**英文原文**（上游权威版本），需要时切中文。

## 提示词语言

三态开关，在 DSH 设置的插件配置里：

| 取值 | 行为 |
|---|---|
| `auto` | 跟随 DSH 界面语言 |
| `zh` | 用中文正文；该专家尚未提供中文正文时回退英文原文并如实标注 |
| `en` | 始终用英文原文（默认） |

中英档案是**同一份档案的两种形态**：只有简介的叫 `intro-only`，另有完整中文正文的叫 `translated`。两种都是合法且完整的档案——没有中文正文不会让专家不可用，只是召唤时用英文。

**现状：279 位里 6 位带中文正文**（其余 273 位是 `intro-only`）。中文名与中文简介是**每一位都有**的，不受这个比例影响。

## 内容来源

| 产物 | 来源 | 许可 |
|---|---|---|
| 英文 persona（`assets/en/`） | [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents)，逐字节同步，不改写 | MIT |
| 中文档案（`assets/zh/`） | 本项目撰写，基于英文的演绎作品 | 随附上游 MIT 原文 |
| 专家头像（`assets/avatar/`） | 本项目，AI 生成后经人工筛选与校验，未使用任何第三方图标集。**素材不进 git 仓库，只保留在本地**；构建时内联进客户端产物 | Apache-2.0 |
| 源码、构建脚本、文档 | 本项目 | Apache-2.0 |

英文一变，对应中文即按源文件哈希标记为过期：**带正文的过期是发布门禁的硬失败**（旧中文人设配新英文指令会误导被召唤的专家），**只有简介的过期只是告警**。见 [`docs/PLAN.md`](docs/PLAN.md) 第 3 节。

上游新增专家时怎么跟上：**`pnpm sync:upstream`** 一条命令拉取、同步、列出还需要人工补写什么，再跑门禁。完整流程与已知限制见 [`docs/UPDATE.md`](docs/UPDATE.md)。

## 机械质量门禁

`pnpm check` 会跑 12 项检查，产出 `sync/report.json`，并把名册分成三堆：

| 检查 | 施加对象 | 硬失败 |
|---|---|---|
| 中文档案必填 `name` / `description` / `intro` / `emoji`（`frontmatter`） | 全部 | 是 |
| 简介 40–600 汉字（`intro`） | 全部 | 是 |
| 英文逐字节对齐上游基线（`english-byte-identity`） | 全部 | 是 |
| 代码围栏闭合（`code-fences`） | 全部 | 是 |
| manifest 覆盖完整（`manifest-coverage`） | 全部 | 是 |
| 分区与 slug 集合一致（`slug-sets`） | 全部 | 是 |
| 翻译新鲜度（`translation-freshness`） | 带正文时硬失败，仅简介时告警 | 视形态 |
| 段落数、标题层级、长度比、术语表、残留外文 | **仅带正文的档案** | 否 |

结构性检查只对比「有正文可对比」的档案；只有简介的档案不会被这些检查判失败。

## 开发

`node` / `npm` 可能不在 PATH；构建链可通过 DSH Desktop 自带的 runtime shim（Node v24.18.1 + pnpm 11.8.0）运行：

```powershell
pnpm install
pnpm dev              # 开发用：watch 重建，DSH 会自动热重载（见下）
pnpm build            # typecheck + tsdown：Host 半边 ESM，客户端半边 ModuleLoader CJS
pnpm exec vitest run  # 单元测试（Host）+ 浏览器端组件测试（jsdom）
pnpm verify           # 发布门禁（包结构、导出、双语 key 一致、分区名单一真源）
pnpm sync             # 从上游同步英文资产并刷新 manifest（离线，不联网）
pnpm sync:upstream    # 上游更新一条龙：fetch+快进 -> 同步 -> 待办清单 -> 12 项门禁
pnpm authoring        # 只看待办：上游变动后还需要人工补写哪些中文档案/头像
pnpm sync:stamp       # 为中文档案盖 sourceSha256（从磁盘推导，不靠译者手填）
pnpm check            # 12 项机械门禁
pnpm sync:calibrate   # 用本项目自己的译文对重测长度比区间
pnpm avatars          # 重新生成 docs/AVATARS.md（卡片头像规格 + 279 个 slug 清单）
pnpm avatars:check <目录>  # 校验一批头像交付：缺/多/超限/viewBox/禁用元素
pnpm avatars:inline   # 由 assets/avatar 重新生成 src/client/avatars.ts（改素材后必跑）
```

本地安装到 DSH profile：

```powershell
dsh plugin --profile desktop add ./dsh-agency-agents-ll
dsh --profile desktop --dump-config    # 应看到 dsh-agency-agents-ll 这一层
```

### 改完代码怎么生效：不用重装，也不用重启

profile 以 **junction（目录符号链接）**指向本仓库，DSH 看到的就是仓库本身，**不存在"安装/更新"这一步**。而 DSH 默认开着两个热重载机制：

| 半边 | 机制 | 行为 |
|---|---|---|
| Host（`lib/index.js`，4 个工具与 Remote 服务） | `@deepseek-ai/cordis-plugin-hmr` | 文件变化后重载插件 |
| 浏览器（`lib/client.js`，名册页与输入栏按钮） | `@deepseek-ai/dsh-client-hmr` | 每 500ms 轮询 bundle，**原地热替换，无需刷新页面** |

所以只要让 `lib/` 保持最新就够了 —— **开着 `pnpm dev`**（tsdown watch），保存源码后：

```
改源码  →  tsdown 自动重建  →  DSH 自动热重载两半  →  界面上直接看到
```

一次也不用刷新、重装或重启。实测：改一行 `src/client/index.ts`，`lib/client.js` 约 4 秒后重建完成。

**两个注意**：热替换会**丢掉被重载插件内的 React 状态**（比如正在编辑的自定义专家草稿）；`pnpm dev` 不跑 typecheck，提交前仍要 `pnpm build`。

## 目录

```
sync/            上游同步、机械门禁、术语表与 manifest
assets/en/       英文上游快照，逐字节同步，不手改
assets/zh/       中文档案：名 + 一句话简介 + 中文简介（+ 可选正文）
src/contract.ts  两端共享的常量与纯函数
src/names.ts     18 个分区的中英显示名（分区名的唯一真源）
src/i18n.ts      Host 文案
src/catalog.ts   名册索引与名称解析
src/persona.ts   按语言读取正文并回退
src/index.ts     Host：4 个工具（list_experts / describe_expert / summon_expert / summon_experts）
src/client/      浏览器：名册页与输入框触发器
docs/PLAN.md     实施规格（契约）
```

完整的决策表、内容模型与阶段验收见 **[`docs/PLAN.md`](docs/PLAN.md)**。
