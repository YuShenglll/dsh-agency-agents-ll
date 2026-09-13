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
| P4 客户端 + Remote | ✅ | 30 项 verify；`--dump-config` 见主行与 remote 行；**用户在浏览器验收「基本功能实现」**；2026-09-13 修掉界面锁死与白屏（见 4.1），随后五轮界面优化（见 4.2–4.7），补 20 项 jsdom 组件测试，合计 **57 项 vitest** |
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
| 浏览器端：设置页渲染、搜索/筛选、查看复制提示词 | 用户口述「基本功能实现」，无截图或 Playwright |
| 浏览器端：`@` 触发菜单、自定义专家编辑器 | 同上 |
| 客户端 `ctx.settingsScope.bind({ namespace })` 是否真能写 `promptLocale` | 未单独验证；失败时会显示 `error.save`，不会静默 |
| Remote 的真实 HTTP 路由 | 用户的设置页能用即间接证明可达 |
| 启用停用（2026-09-13 修复后） | 由 8 条 jsdom 组件测试覆盖，其中 3 条在修复前必失败；**仍需一次真机复测** |
| `.aall-switch` 绝对定位输入的包含块 | 已加 `position:relative` 兜底；未确认宿主对 `input[type=checkbox]` 是否有更高优先级的全局规则 |

## 4.1 2026-09-13 的界面故障与修复

**现象**（用户报告）：点第二个专家的启用 → 界面锁死，下半窗口点不动也滚不动；点第三个 → 整页变白，列表消失。

**根因**：不是布局问题，是三个可复现的客户端缺陷叠加，最后被 DSH 的槽位错误边界放大成白屏。

| 缺陷 | 证据 | 修法 |
|---|---|---|
| `busy` 是**页面级**的，一次写入把 279 张卡的开关和链接全部 `disabled` | 新测试在旧代码上失败：`expected 279 to be 1` | 忙碌改为**按卡片**（D14） |
| `runWrite` 的 `saving.current` 哨兵**静默丢弃**后续点击 | 新测试在旧代码上失败：`expected 1 to be 3`；磁盘上 `settings.yaml` 恰好只有 `enabled: [academic-historian]` 一项，与连点两下只落一次吻合 | 改为**按点击顺序排队**，每个写入读当轮 revision（D13） |
| 渲染期抛错无人接住 → `settings.section` 条目被**退役**，刷新前不再回来 | 新测试在旧代码上失败：错误直接冒泡出组件 | 加 `SectionBoundary`（D15）+ 贡献改为 Remote 挂载**之后**才注册，消除「服务未就绪就渲染」这条必抛路径 |

**顺带修掉但不构成病因的**：

- 隐藏 checkbox 是 `position:absolute` 而父级 `<label>` 没有定位，包含块会逃到设置面板；已加 `position:relative` + `inset:0` + `pointer-events:none`。
- `useSyncExternalStore` 每渲染都换新的 `subscribe`/`getSnapshot` 闭包 → 每次渲染都退订重订。改为按 Remote 面缓存（`catalogSubscription`），与 harness 自己的 `localeSubscriptionCache` 同法。
- `sortByEnabled` 是**死代码**：`groupByDivision` 会用 slug 重排每个分组，把它刚排好的顺序又盖回去。所以卡片其实从没移动过 —— 已删除该函数，并在 D12 把「顺序恒定」写进契约。
- 卡片加 `React.memo`：一次写入只重绘那一张，而不是 279 张。

**未解释的**：用户描述的「窗口上移」。既然卡片从没重排过，最可能是界面锁死期间的滚动/面板位移，随锁死一起消失。若真机复测后仍在，需重新定位。

## 4.2 界面微调（2026-09-13，用户验收通过之后）

| 诉求 | 改动 |
|---|---|
| 设置里的「双语专家名册」改叫「专家库」 | 词条 `nav` 与 `title` 同时改。两处原本是同一个字符串，只改一处会让导航项和页标题不一致 |
| 输入栏按钮「召唤专家」改叫「专家」，文字前加个好看的符号 | 拆成两个键：`menu.button`（按钮可见文字）与 `menu.title`（悬停提示，仍是「召唤专家」）。图标从 14px **描边**四角星换成 15px **实心**双星火花 —— 描边星在标签尺寸下会糊成一团 |
| 页头按钮与标题对齐；删掉副标题那句 | `.aall-head` 的 `align-items` 由 `flex-end` 改为 `flex-start`（原来按钮被推到底部，才会与摘要行而非标题对齐）；标题 `line-height` 28→32px 与按钮同高，顶边才真正对齐；删除 `subtitle` 词条与 `.aall-subtitle` 规则 |
| 提示词语言下面按钮的右侧多出空白 | `.aall-segmented` 补 `align-self:flex-start` |

最后一条是真实缺陷而不是审美偏好：`.aall-field` 是纵向 flex，交叉轴默认 `stretch`，会把 `display:inline-flex` 的分段控件拉到字段的 200px 宽，而三个按钮只占约 162px —— 那 38px 空白是**画在边框里面的**。`display:inline-flex` 的盒子一旦成为 flex 子项，`align-self:stretch` 就会覆盖它的收缩行为。

## 4.3 密度与辨识度（2026-09-13，第二轮反馈）

用户的原话是「270 多个卡片不好翻」，所以这一轮除了他点名的三处，还做了两处**不隐藏任何内容**的导航优化。

| 诉求 | 改动 |
|---|---|
| 分区名太小、看不出分类 | `.aall-group-title` 14→16px，加左侧 3px 竖条（`::before`），计数从纯文本改成圆角胶囊。并且 **`position:sticky;top:0`** —— 滚动时分区名一直挂在顶部，这是「一看到就知道在哪个分类」的直接答案。背景用 `--dsw-alias-bg-layer-2`，与设置面板自身底色（`SettingsRoot.module.css:92`）同色，所以贴顶时严丝合缝 |
| 右侧「已停用」占太宽，希望文字顶到右边 | 去掉开关的文字标签，只留 40px 的轨道。第三列从约 100px 缩到约 40px，正文列宽增加约 60px，简介每行多排 3–4 个字，整张卡少 1–2 行。状态由轨道颜色 + 卡片绿边表达，可访问性由 `aria-label` 承担 |
| 卡片下的「新建自定义专家」不要了，另两个按钮太小 | 出厂专家只留「查看提示词 / 复制提示词」两个动作；自定义专家才多出「编辑 / 删除」。新建入口只保留页头一个。两个动作从 12px 下划线文字改成 13px + 14px 图标的描边按钮（`min-height:30px`），点击区域明显变大 |
| （额外）密度 | 分区与徽章合并成一行 `.aall-meta`（省约 20px）；卡片内边距 12→10px；列表与分区间距 8→6px；简介行高 21→20px。**综合下来每张卡大约矮 25%，且一个字都没藏** |
| （额外）快速跳到已启用 | 筛选行加「只看已启用」复选框。279 张卡里找自己开过的那几个，原来只能靠翻 |

**特意没做的**：把简介默认折叠起来。那是能一次砍掉一半高度的最大杠杆，但简介就是这个插件的全部价值所在，折叠等于默认藏起它 —— 属于产品决策，等用户点头再做。

## 4.4 卡片文字占满整行（2026-09-13，第三轮反馈）

用户原话：「整个文字界面靠左对齐，右上角按钮的右边和文字框的右边对齐。」这两句是同一件事的两端 —— 简介那段的左边缘和右边缘。

**改前**：`.aall-card-body` 本身是一个 `36px | 1fr | auto` 的三列网格，简介被关在中间那一列里。所以它左边缩进了 36px + 间距（跟姓名对齐、而不是跟 emoji 对齐），右边又被开关那一列吃掉约 50px。用户在截图里用红框圈出的，正是姓名右边那块被浪费掉的空间。

**改后**：`.aall-card-body` 变成纵向 flex，里面只有 `.aall-card-head` 这一行还是网格（emoji | 姓名+分区 | 开关）；简介与英文说明移到 head 之外，作为 body 的直接子元素，**独占整行**。

由此三处内边距落在同一条竖线上：

| 元素 | 左右内边距 |
|---|---|
| `.aall-card-body` | `10px 12px` |
| `.aall-card-head` | 无（撑满 body 的内容宽） |
| `.aall-card-foot` | `0 12px 10px` |

于是简介的左边缘 = emoji 的左边缘 = 底部两个按钮的左边缘；简介的右边缘 = 开关的右边缘 = 12px 内边距处。**左右都对齐了，而且简介宽度从约 440px 涨到约 536px，同样 250 字少排约 1.5 行，卡片又矮了一截。**

`@media (max-width:640px)` 那条窄屏规则也跟着从 `.aall-card-body` 改指 `.aall-card-head`。

## 4.5 「仅英文人设」标签的误会（2026-09-13）

用户看到卡片上的「仅英文人设 / 中文人设」标签，问「不是都有中文提示词么」。

**这是两个不同的东西，而混淆是我造成的** —— 4.2 那一轮按用户要求删掉的副标题「中文名与中文简介始终显示；只有人设提示词会跟随语言切换。」**正是这句解释**。

实测数据（`assets/zh` 全量扫描）：

| 项 | 数量 |
|---|---|
| 中文档案总数 | 279 |
| 有中文简介 `intro` | **279**（全部） |
| 有中文人设正文 | **6** |

那 6 个：`academic-anthropologist`、`engineering-code-reviewer`、`marketing-short-video-editing-coach`、`product-manager`、`research-synthesist`、`security-senior-secops`。它们是**从原插件资产里继承来的**（原插件 321 份中文里只有这几份是真翻译，其余是模板残渣），不是我们产出的。

**改法**：只在**例外**上加标签。

- 273 张卡不再有任何人设标签 —— 一个出现在 97.8% 卡片上的标签不携带信息
- 6 张有中文人设的卡显示「中文提示词」（原「中文人设」）；改名是为了和「中文简介」区分开
- `badge.notTranslated` 词条从 zh/en 两侧删除
- `prompt.locale.zh/en` 同步改成「中文提示词 / 英文提示词」，`prompt.fallback` 改成「这位专家只有英文提示词，已回退英文原文。」—— 查看提示词弹窗本来就是报告语言的地方，也是唯一需要这条信息的地方

**要不要把那 6 份中文人设正文也删掉**（让 279 个专家的行为完全一致）留给用户决定：删了更一致，留着则是白捡的 6 份中文提示词。

## 4.6 搜索框宽度会跳（2026-09-13）

用户点「只看已启用」后发现搜索框变宽了。

**原因**：`.aall-field{flex:1 1 220px}` 让搜索框**吃掉整行的剩余空间**。设置面板的滚动条是**实占 8px** 的（`ui-theme/src/styles/scrollbar.css` 的 `--dsh-scrollbar-width: 8px`，不是覆盖式滚动条），所以：

- 名册有 279 张卡 → 面板出现滚动条 → 内容区窄 8px → 搜索框跟着窄 8px
- 点「只看已启用」后结果为空 → 列表塌掉 → 滚动条消失 → 内容区宽 8px → 搜索框宽 8px

**任何 `flex-grow` 的元素都会吸收这个差值。** 修法是让它别长：筛选行里所有字段改成固定 `flex-basis` 且 `flex-grow:0`（`flex-shrink` 保留，窄面板仍能正常换行）。

顺带把「只看已启用」移到提示词语言之后，这一行于是稳定地折成两行：`搜索 | 分区` / `提示词语言 | 只看已启用`。

**这条也解释了 4.1 里一直没解释的「窗口上移」** —— 任何改变列表长度、从而切换滚动条的操作，都会让内容横向位移 8px。

### 一个值得记住的教训

改这段 JSX 时漏掉了一个右括号，结果：

- `pnpm exec vitest run` **全绿通过**
- `pnpm build`（先跑 `tsc`）**报错 `TS1005: ',' expected`**

因为 `return A, B, C` 是合法的**逗号运算符**，参数表少一个右括号会把整段尾巴变成兄弟表达式却仍然解析通过 —— 组件照常渲染，只是层级变了。

**所以：跑测试前一定先跑 `pnpm build`（内含 typecheck），不要只跑 vitest。** 另外补了一条结构性断言（`.aall-head` / `.aall-filters` 必须是 `.aall-section` 的直接子元素，且 filters 不能吞掉 head），把这类"能解析但结构错了"的回归钉死。

## 4.7 页头按钮也会跳 + 自建专家怎么删（2026-09-13）

### 按钮跳动：和 4.6 同一个病根，症状相反

4.6 只治了「会伸缩的搜索框」。页头那两个按钮是靠 `margin-left:auto` **贴右边缘**的 —— 容器宽 8px，它们就右移 8px。**凡是锚定右边缘的元素，都躲不开。**

所以这次修到根上，直接让滚动条不再改变内容宽度：

```css
:has(> .aall-section){scrollbar-gutter:stable}
```

**为什么能命中**：设置外壳的结构是 `SettingsRoot.tsx:94-96` 的

```jsx
<div className={css.options}>          {/* overflow-y: auto */}
  {renderSlot('settings.section', ...)}
</div>
```

而列表槽位的渲染路径（`scoped-slots.tsx:866-871`）返回的是 `<>{list.map(...)}</>` 片段，外层 `guarded()` 就是 `SlotErrorBoundary` —— **一个类组件，不产生 DOM 元素**。所以 `.options` 确实是我的 `.aall-section` 的**直接父节点**，`:has(> …)` 精确命中。

`scrollbar-gutter` 对非滚动容器是无效属性，所以万一日后宿主加了一层包装，这条规则**退化成空操作，不会帮倒忙**，只是跳动会回来。

**注意**：这是整个样式表里**唯一一条不以 `.aall-` 开头的规则**。它是有意为之，注释里写明了理由。

同时保留 4.6 的固定 `flex-basis`（纵深防御：`scrollbar-gutter` 失效时搜索框仍然稳定）。

### 自建专家的删除入口

原来只有**自定义专家的卡片页脚**上有「编辑 / 删除」两个链接。用户有 0 个自建专家，所以满屏找不到删除入口 —— 问了「自建的专家怎么删除？」。

改法：**编辑弹窗的页脚左侧加一个红色「删除」按钮**，只在编辑既有专家时出现（新建时没有），点了先关弹窗再弹确认框。这才是人会去找的地方。

配套改动：`pendingDelete` 的类型从 `ExpertSummary` 收窄成 `{slug, name}`，因为现在有两个来源（卡片和弹窗），而两者只需要这两个字段。


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
| 客户端包 250 KB | 主要来自内联的 zod（Remote 描述符 codec + 编辑器预校验）。参考实现同样如此。要瘦身得把编辑器预校验换成手写检查，但描述符共用就意味着 zod 一定进客户端包 |
| 参考实现里没有移植的能力 | 「猜宿主设置按钮」的 DOM 启发式。宿主 `ui-settings-general` 本地不可读、无法验证，故不做；菜单空态改为提示「请先在设置页启用」 |
| 与 `@michengai/dsh-agency-agents` 的关系 | 用户已自行卸载。若两者同时安装会**工具名冲突**（都注册 `list_experts` / `summon_expert` / `summon_experts`） |

## 9. 续工起点

- 改 Host 逻辑 → `src/index.ts`（工具与 catalog）、`src/remote.ts`（Remote 方法）、`src/roster-settings.ts`（enabled 与自定义专家）
- 改浏览器端 → `src/client/index.ts`（页面与触发器）、`src/client/locales.ts`（词条，zh 为 key 集真源，en 由 `satisfies` 编译期强制一致）
- 改浏览器端之后 → 必须跑 `pnpm exec vitest run src/client/index.test.ts`：这 8 条在 jsdom 里用**真实的 279 份资产**渲染真实组件，是唯一能在没有浏览器的情况下抓到「一次写入锁死整页」「连点被吞」「抛错变白屏」的地方。**新写这类断言时先在旧代码上跑一遍确认它会失败**，否则它只是装饰
- 改资产或术语 → 动 `assets/`、`sync/glossary.json` 后必须跑 `pnpm sync:stamp && pnpm check`
- 改契约 → 先改 `docs/PLAN.md` 再改代码

英文侧**永远不要手改**：`assets/en/` 是上游快照，`pnpm check` 会逐字节核对，改了必然硬失败。
