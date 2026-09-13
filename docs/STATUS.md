# 当前状态与续工指南

本文档记录**现在到哪一步了、怎么验证、怎么继续**。设计决策与规则以 [`PLAN.md`](PLAN.md) 为唯一真源，本文不重复。

## 1. 一句话

插件已建成并**在 desktop profile 上运行**：DeepSeek Harness 的中英双语 Agency 专家名册，279 位专家 / 18 个分区，中文名与中文简介齐备，提示词语言可切换，Host 工具与浏览器端均可用。

## 2. 阶段状态

| 阶段 | 状态 | 证据 |
|---|---|---|
| P0 骨架 | ✅ | 双端构建产出；隔离 profile `--dump-config` 见层 |
| P1 数据管线 | ✅ | 英文资产 279/279 与上游 `ad9264e` 逐字节一致（git blob SHA 多重集比对）；`pnpm sync` 连跑三次幂等 |
| P2 中文档案 | ✅ | 279 份 `aligned`，0 suspect / 0 missing；简介中位数 232 汉字 |
| P3 Host 功能 | ✅ | 37 项 vitest；4 个工具在线 |
| P4 客户端 + Remote | ✅ | 30 项 verify；`--dump-config` 见主行与 remote 行；**用户在浏览器验收「基本功能实现」** |
| P5 发布 | ⏳ | 只差打 tag |

## 3. 已实测的端到端路径

2026-09-13 在运行中的 desktop profile 上实测：

```
list_experts            → 共 279 位可选专家，覆盖 18 个分区（分区名 + 计数 + 每位专家的 emoji 与中文名）
describe_expert(上线就绪度评审专家)
                        → 🧐 上线就绪度评审专家（测试）
                          英文名：Reality Checker
                          一句话简介：以证据否决幻想式验收……
                          中文简介：<完整简介>
                          中文提示词：未提供，召唤时使用英文原文
```

`describe_expert` 的输出同时证明了四件事：中文名解析、英文名映射、`intro` 读取、以及**中英档案形态判定**（该专家是 `intro-only`，如实报告会回退英文）。

## 4. 尚未实测的路径

诚实清单，别当成已验证：

| 项 | 状态 |
|---|---|
| `summon_expert` / `summon_experts` 真实召唤一位专家 | 未跑过（需要一次真实的子代理运行） |
| 浏览器端：设置页渲染、搜索/筛选、启用停用、查看复制提示词 | 用户口述「基本功能实现」，无截图或 Playwright |
| 浏览器端：`@` 触发菜单、自定义专家编辑器 | 同上 |
| 客户端 `ctx.settingsScope.bind({ namespace })` 是否真能写 `promptLocale` | 未单独验证；失败时会显示 `error.save`，不会静默 |
| Remote 的真实 HTTP 路由 | 用户的设置页能用即间接证明可达 |

## 5. 环境要点（重开会话必读）

- **`node` / `npm` 不在 PATH。** 一律用 `pnpm exec node <文件>` 或 `pnpm run <script>`；`pnpm`（11.8.0）由 DSH Desktop 的 runtime shim 提供，自带 Node v24.18.1。
- **Windows PowerShell 5.1 会把无 BOM 的 UTF-8 `.ps1` 按 ANSI 解码而乱码。** 含中文字面量的脚本必须先转成带 BOM 再执行（`run-all.ps1` 是现成范例）。
- **不要用 `pwsh` 内联 `pnpm exec node -e "…"` 跑含正则或引号的脚本** —— PowerShell 会把它解析坏；写成 `%TEMP%` 下的临时 `.mjs` 再执行。
- `dsh` 与 `pnpm` 的 shim 路径里含随版本变化的 `<hash>`，**脚本中不要硬编码**，用 `Get-Command` 解析。
- 当前没有任何 node/临时脚本残留；`%TEMP%` 里的辅助脚本与本仓库无关。

## 6. 常用命令

```powershell
cd G:\dsh\dsh-agency-agents-ll
pnpm build              # typecheck + tsdown（Host ESM / 客户端 ModuleLoader CJS）
pnpm exec vitest run    # 37 项单元测试
pnpm verify             # 30 项发布门禁
pnpm check              # 12 项机械门禁 → sync/report.json
pnpm sync               # 拉上游英文资产、刷新 manifest（幂等）
pnpm sync:stamp         # 为中文档案盖 sourceSha256（从磁盘推导）
pnpm sync:calibrate     # 用本项目自己的译文对重测长度比区间
```

安装 / 卸载（desktop profile）：

```powershell
dsh plugin --profile desktop add G:\dsh\dsh-agency-agents-ll
dsh plugin --profile desktop remove dsh-agency-agents-ll
dsh --profile desktop --dump-config      # 应见 agency-agents-ll 与 /remote 两行
```

隔离验证 profile `lltest`（`C:\Users\LL\.dsh\profiles\lltest`）同样以 link 方式装着本插件，改代码后无需重装即可验证，**不会影响 desktop**。

## 7. 门禁速查

`pnpm check` 的 12 项里哪些是硬失败（会让 exit code 非 0）：

| 硬失败 | 其余只计入 suspect |
|---|---|
| 中文档案必填 `name`/`description`/`intro`/`emoji` | 段落数与英文精确相等 |
| 简介 40–600 汉字 | 标题层级一致 |
| 英文逐字节对齐上游基线 | 长度比落在 `[0.7, 3.2]` |
| 代码围栏闭合 | 术语表一致性 |
| manifest 覆盖完整 | 正文无残留英文 |
| 翻译新鲜度（**仅当该档案带正文**） | |

档案两种形态：`intro-only`（273 份，名册显示中文、召唤回退英文）与 `translated`（6 份，带完整中文正文）。**结构性检查只施加于带正文的档案**。

## 8. 遗留与可选项

| 项 | 说明 |
|---|---|
| P5 tag | 只差 `git tag`。建议在真实召唤一次专家之后再打 |
| `summon_expert` 首次真跑 | 会调用 `ctx.subagents.start`，是本项目唯一还没跑过的主路径 |
| 客户端包 245 KB | 主要来自内联的 zod（Remote 描述符 codec + 编辑器预校验）。参考实现同样如此。要瘦身得把编辑器预校验换成手写检查，但描述符共用就意味着 zod 一定进客户端包 |
| 参考实现里没有移植的能力 | 「猜宿主设置按钮」的 DOM 启发式。宿主 `ui-settings-general` 本地不可读、无法验证，故不做；菜单空态改为提示「请先在设置页启用」 |
| 与 `@michengai/dsh-agency-agents` 的关系 | 用户已自行卸载。若两者同时安装会**工具名冲突**（都注册 `list_experts` / `summon_expert` / `summon_experts`） |

## 9. 续工起点

- 改 Host 逻辑 → `src/index.ts`（工具与 catalog）、`src/remote.ts`（Remote 方法）、`src/roster-settings.ts`（enabled 与自定义专家）
- 改浏览器端 → `src/client/index.ts`（页面与触发器）、`src/client/locales.ts`（词条，zh 为 key 集真源，en 由 `satisfies` 编译期强制一致）
- 改资产或术语 → 动 `assets/`、`sync/glossary.json` 后必须跑 `pnpm sync:stamp && pnpm check`
- 改契约 → 先改 `docs/PLAN.md` 再改代码

英文侧**永远不要手改**：`assets/en/` 是上游快照，`pnpm check` 会逐字节核对，改了必然硬失败。
