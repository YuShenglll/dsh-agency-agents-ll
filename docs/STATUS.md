# 当前状态与续工指南

本文档记录**现在到哪一步了、怎么验证、怎么继续**。设计决策与规则以 [`PLAN.md`](PLAN.md) 为唯一真源，本文不重复。

## 1. 一句话

插件已建成并**在 desktop profile 上运行**：DeepSeek Harness 的中英双语 Agency 专家名册，279 位专家 / 18 个分区，中文名与中文简介齐备，提示词语言可切换，Host 工具与浏览器端均可用。**系统提示里也会告诉模型名册存在**，并写明「只在用户明确要求时才召唤」（见 §5.19）。

> **还没实测的**：只剩浏览器端几个没人碰过的控件 —— 查看提示词 / 复制提示词、筛选（只看已启用）、自定义专家编辑器。设置页搜索、`@` 触发菜单、真实召唤、以及改名后两位专家的卡片开关**都已实测**（见第 3 节，完整清单见第 4 节）。
> 基础设施与四条工具路径均已实测通过；没有进行中的改动，工作区干净。

> **5.6–5.9 是同一个问题的四轮收敛**：设置面板的滚动条随名册长短出现/消失，内容框宽度差 8px。
> 前两轮治的都是症状（会伸缩的字段、右锚定的按钮），5.9 才从根上锁死宽度，**已经用户实测确认**。
> 诊断这类问题先问「什么东西的尺寸在变」，而不是「哪个元素在动」。

> **本文档由两个会话交替写成**（2026-09-13，其中一个会话事后被删除）。所以 §5 里能看到被后一轮推翻的前一轮结论 —— 那是真实的收敛过程，按发生顺序保留，**一律以最后一轮为准**。

## 2. 阶段状态

| 阶段 | 状态 | 证据 |
|---|---|---|
| P0 骨架 | ✅ | 双端构建产出；隔离 profile `--dump-config` 见层 |
| P1 数据管线 | ✅ | 英文资产 279/279 与上游 `ad9264e` 逐字节一致（git blob SHA 多重集比对）；`pnpm sync` 连跑三次幂等 |
| P2 中文档案 | ✅ | 279 份 `aligned`，0 suspect / 0 missing；简介中位数 232 汉字 |
| P3 Host 功能 | ✅ | 4 个工具在线（`list_experts` / `describe_expert` / `summon_expert` / `summon_experts`） |
| P4 客户端 + Remote | ✅ | 用户已在浏览器验收；2026-09-13 修掉界面锁死与白屏（5.1），随后八轮界面优化与修复（5.2–5.9）。**其中 5.6–5.9 是同一个「内容框宽度随滚动条变化」的四轮收敛** |
| P5 发布 | ⏳ | 只差打 tag。**四条工具路径已全部真跑过**（见第 3 节），可以打了 |
| P6 头像 | ✅ | 279/279 交付、校验、接入（见 5.10）。`verify` 三条门禁钉住一致性；明暗主题均已真机确认 |

**门禁现状（2026-09-13，含 §5.18 的整改；HEAD 见 `git log`）**：

```
pnpm build   exit=0      （typecheck：avatars:inline + 两份 tsconfig；然后 tsdown）
pnpm test    107 passed  （roster-settings 17 + remote 16 + host 40 + client/jsdom 34）
pnpm verify  exit=0      35 项
pnpm check   exit=0      13 项，roster 279 / aligned 279 / suspect 0 / missing 0
pnpm authoring exit=0    0 项待办
```

> 另有一套不在 `pnpm` 脚本里的一致性验证：**全新 clone 后 `assets/en` 279 个文件必须与上游逐字节一致**。这条以前是坏的，见 5.16。


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

**`summon_experts` 真实召唤（2026-09-13，用户发起，两个专家并行）**：

用户在输入框里 `@文化人类学家 @品牌守护者` 并发送 —— 这一条**同时验证了三件事**：

1. **`@` 引用能送达** —— 修掉 5.11 那个 source 名不一致之后，提交不再被 `no serializer` 拦下。
2. **中文名解析**：两个中文名都精确命中，`describe_expert` 各自返回正确的英文名、分区、简介。
3. **档案形态判定**：人类学家报「中文提示词：已提供」，品牌守护者报「未提供，召唤时使用英文原文」—— 与卡片上有没有「中文提示词」徽章完全一致。

两个专家都返回了各自领域内的实质报告（不是空跑），并**当场找出 4 个可核实的文档错误**，见 5.12。

**整改之后的真机复测（2026-09-13，用户操作，见 5.18）**：

用户在设置页搜索「购物车」→ 看到改名后的两张卡片 → 在输入框 `@WordPress 电商购物车工程师 @Drupal 电商购物车工程师` 并**发送成功**。这一条同时验证了四件事：

1. **`@` 触发菜单在真实输入栏可用** —— 能弹出、能列出专家、能插入引用（这条以前一直挂在第 4 节的"未实测"里）。
2. **改名已生效到运行中的插件** —— 菜单里出现的是两个**新**中文名，说明后台半边确实已经加载了整改后的版本。
3. **引用能发出去** —— 5.11 那个 `no serializer` 的失败面不再出现，提交没有被拦下。
4. **引用送达了父代理** —— 父代理据此真实召唤了这两位专家。

**同一次的真实召唤（两位并行）**：两位专家各自带着自己的 persona 返回了报告，**证明「改名 → 名册 → 按名解析 → persona → 子代理」整条链路可用**。这是 B1 修好之后第一次真机端到端召唤，也是改名没有破坏"按名召唤"的直接证据。

**整改后重启，卡片开关实测（同日）**：重启后拨动这两位专家的开关，**能正常打开与关闭，不再报 `error.unavailable`**。这条补上了整改期间最后一个悬念 —— 重启前那一次点击报错，是因为后台半边仍运行旧版本（见 5.18 的现场记录），换成新版本后该路径正常。它同时说明 `setEnabled` 的新守卫（"名册定义过的 slug，冲突与否无关"）在真机上成立，**而不只是在测试里成立**。

> **方法论备注（用户当场指出的）**：这次冒烟测试**只用来回答"链路通不通"**。被召唤的专家在自己的专业领域里说了什么，是他们自己的事，**不是这个插件的验收标准** —— 本插件的产品是名册与召唤的**机制**，不是任何一位专家的文案质量。把工具的输出当成产品反馈，是评审者容易犯的框架错误。

## 4. 尚未实测的路径

诚实清单，别当成已验证。**四条工具路径已全部真跑过**，浏览器端的 `@` 触发与真实召唤也已实测（均见第 3 节），下面剩下的仍未验证：

| 项 | 状态 |
|---|---|
| 浏览器端：设置页渲染、搜索 | **已实测**（整改后）：搜索「购物车」正常返回结果 |
| 浏览器端：`@` 触发菜单 | **已实测**（整改后）：能弹出、能插入、能发送 |
| 浏览器端：查看提示词 / 复制提示词 | **未实测**（用户没走过这两个按钮） |
| 浏览器端：筛选（只看已启用）、自定义专家编辑器 | **未实测**（用户没有自建专家） |
| 卡片开关（整改后重启） | **已实测**（同日）：重启后拨动两位改名专家的开关，能正常开关、**不再报错**（见第 3 节）。此前那条 `error.unavailable` 是旧后台半边造成的 |
| 客户端 `ctx.settingsScope.bind({ namespace })` 是否真能写 `promptLocale` | 未单独验证；失败时会显示 `error.save`，不会静默 |
| Remote 的真实 HTTP 路由 | 用户的设置页能用即间接证明可达；`@` 菜单实测后这条更硬了 |
| `.aall-switch` 绝对定位输入的包含块 | 已加 `position:relative` 兜底；未确认宿主对 `input[type=checkbox]` 是否有更高优先级的全局规则 |
| 卡片宽度随滚动条变 8px | **5.9 已治并经用户实测确认**。若日后复发，剩下的两手见 5.9 末尾 |
| 头像素材 | **已完成**，见 5.10：279/279 交付、格式全过、明暗主题均已真机确认 |

## 5. 2026-09-13 的修复与优化记录

以下按发生顺序。每条都记了现象、根因、修法与证据。

## 5.1 2026-09-13 的界面故障与修复

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

## 5.2 界面微调（2026-09-13，用户验收通过之后）

| 诉求 | 改动 |
|---|---|
| 设置里的「双语专家名册」改叫「专家库」 | 词条 `nav` 与 `title` 同时改。两处原本是同一个字符串，只改一处会让导航项和页标题不一致 |
| 输入栏按钮「召唤专家」改叫「专家」，文字前加个好看的符号 | 拆成两个键：`menu.button`（按钮可见文字）与 `menu.title`（悬停提示，仍是「召唤专家」）。图标从 14px **描边**四角星换成 15px **实心**双星火花 —— 描边星在标签尺寸下会糊成一团 |
| 页头按钮与标题对齐；删掉副标题那句 | `.aall-head` 的 `align-items` 由 `flex-end` 改为 `flex-start`（原来按钮被推到底部，才会与摘要行而非标题对齐）；标题 `line-height` 28→32px 与按钮同高，顶边才真正对齐；删除 `subtitle` 词条与 `.aall-subtitle` 规则 |
| 提示词语言下面按钮的右侧多出空白 | `.aall-segmented` 补 `align-self:flex-start` |

最后一条是真实缺陷而不是审美偏好：`.aall-field` 是纵向 flex，交叉轴默认 `stretch`，会把 `display:inline-flex` 的分段控件拉到字段的 200px 宽，而三个按钮只占约 162px —— 那 38px 空白是**画在边框里面的**。`display:inline-flex` 的盒子一旦成为 flex 子项，`align-self:stretch` 就会覆盖它的收缩行为。

## 5.3 密度与辨识度（2026-09-13，第二轮反馈）

用户的原话是「270 多个卡片不好翻」，所以这一轮除了他点名的三处，还做了两处**不隐藏任何内容**的导航优化。

| 诉求 | 改动 |
|---|---|
| 分区名太小、看不出分类 | `.aall-group-title` 14→16px，加左侧 3px 竖条（`::before`），计数从纯文本改成圆角胶囊。并且 **`position:sticky;top:0`** —— 滚动时分区名一直挂在顶部，这是「一看到就知道在哪个分类」的直接答案。背景用 `--dsw-alias-bg-layer-2`，与设置面板自身底色（`SettingsRoot.module.css:92`）同色，所以贴顶时严丝合缝 |
| 右侧「已停用」占太宽，希望文字顶到右边 | 去掉开关的文字标签，只留 40px 的轨道。第三列从约 100px 缩到约 40px，正文列宽增加约 60px，简介每行多排 3–4 个字，整张卡少 1–2 行。状态由轨道颜色 + 卡片绿边表达，可访问性由 `aria-label` 承担 |
| 卡片下的「新建自定义专家」不要了，另两个按钮太小 | 出厂专家只留「查看提示词 / 复制提示词」两个动作；自定义专家才多出「编辑 / 删除」。新建入口只保留页头一个。两个动作从 12px 下划线文字改成 13px + 14px 图标的描边按钮（`min-height:30px`），点击区域明显变大 |
| （额外）密度 | 分区与徽章合并成一行 `.aall-meta`（省约 20px）；卡片内边距 12→10px；列表与分区间距 8→6px；简介行高 21→20px。**综合下来每张卡大约矮 25%，且一个字都没藏** |
| （额外）快速跳到已启用 | 筛选行加「只看已启用」复选框。279 张卡里找自己开过的那几个，原来只能靠翻 |

**特意没做的**：把简介默认折叠起来。那是能一次砍掉一半高度的最大杠杆，但简介就是这个插件的全部价值所在，折叠等于默认藏起它 —— 属于产品决策，等用户点头再做。

## 5.4 卡片文字占满整行（2026-09-13，第三轮反馈）

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

## 5.5 「仅英文人设」标签的误会（2026-09-13）

用户看到卡片上的「仅英文人设 / 中文人设」标签，问「不是都有中文提示词么」。

**这是两个不同的东西，而混淆是我造成的** —— 5.2 那一轮按用户要求删掉的副标题「中文名与中文简介始终显示；只有人设提示词会跟随语言切换。」**正是这句解释**。

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

## 5.6 搜索框宽度会跳（2026-09-13）

用户点「只看已启用」后发现搜索框变宽了。

**原因**：`.aall-field{flex:1 1 220px}` 让搜索框**吃掉整行的剩余空间**。设置面板的滚动条是**实占 8px** 的（`ui-theme/src/styles/scrollbar.css` 的 `--dsh-scrollbar-width: 8px`，不是覆盖式滚动条），所以：

- 名册有 279 张卡 → 面板出现滚动条 → 内容区窄 8px → 搜索框跟着窄 8px
- 点「只看已启用」后结果为空 → 列表塌掉 → 滚动条消失 → 内容区宽 8px → 搜索框宽 8px

**任何 `flex-grow` 的元素都会吸收这个差值。** 修法是让它别长：筛选行里所有字段改成固定 `flex-basis` 且 `flex-grow:0`（`flex-shrink` 保留，窄面板仍能正常换行）。

顺带把「只看已启用」移到提示词语言之后，这一行于是稳定地折成两行：`搜索 | 分区` / `提示词语言 | 只看已启用`。

**这条也解释了 5.1 里一直没解释的「窗口上移」** —— 任何改变列表长度、从而切换滚动条的操作，都会让内容横向位移 8px。

### 一个值得记住的教训

改这段 JSX 时漏掉了一个右括号，结果：

- `pnpm exec vitest run` **全绿通过**
- `pnpm build`（先跑 `tsc`）**报错 `TS1005: ',' expected`**

因为 `return A, B, C` 是合法的**逗号运算符**，参数表少一个右括号会把整段尾巴变成兄弟表达式却仍然解析通过 —— 组件照常渲染，只是层级变了。

**所以：跑测试前一定先跑 `pnpm build`（内含 typecheck），不要只跑 vitest。** 另外补了一条结构性断言（`.aall-head` / `.aall-filters` 必须是 `.aall-section` 的直接子元素，且 filters 不能吞掉 head），把这类"能解析但结构错了"的回归钉死。

## 5.7 页头按钮也会跳 + 自建专家怎么删（2026-09-13）

### 按钮跳动：和 5.6 同一个病根，症状相反

5.6 只治了「会伸缩的搜索框」。页头那两个按钮是靠 `margin-left:auto` **贴右边缘**的 —— 容器宽 8px，它们就右移 8px。**凡是锚定右边缘的元素，都躲不开。**

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

同时保留 5.6 的固定 `flex-basis`（纵深防御：`scrollbar-gutter` 失效时搜索框仍然稳定）。

### 自建专家的删除入口

原来只有**自定义专家的卡片页脚**上有「编辑 / 删除」两个链接。用户有 0 个自建专家，所以满屏找不到删除入口 —— 问了「自建的专家怎么删除？」。

改法：**编辑弹窗的页脚左侧加一个红色「删除」按钮**，只在编辑既有专家时出现（新建时没有），点了先关弹窗再弹确认框。这才是人会去找的地方。

配套改动：`pendingDelete` 的类型从 `ExpertSummary` 收窄成 `{slug, name}`，因为现在有两个来源（卡片和弹窗），而两者只需要这两个字段。

## 5.8 页头按钮二次修正：不再锚定右边缘（2026-09-13）

5.7 那条 `:has(> .aall-section){scrollbar-gutter:stable}` **经用户实测无效**，按钮照样跳。

失败原因无法在本机验证（需要看真实 DOM），但结论很清楚：**这个修法把正确性押在了宿主内部结构上**（滚动容器是不是 `.options`、中间有没有多一层包装、`scrollbar-gutter` 与宿主自定义 `::-webkit-scrollbar` 是否共存），而这些我一样都验证不了。

**改法：不再依赖任何宿主细节。** 让按钮**不锚定右边缘**（`flex:0 1 auto` + 删掉 `margin-left:auto`），页头完全从左往右排。

**这次修正还不够。** 用户随后反馈：页头的按钮应该和下面卡片的右边缘对齐，而且**卡片自己也在跳**（宽度随滚动条来回变 8px）。也就是说 5.6/5.7 治的都是症状，**真正的病根是内容框宽度会变**，只要这个不变，按钮怎么锚都不会跳。

## 5.9 病根：让滚动条永远不消失（2026-09-13）

**为什么前两次都没治好**：5.6 治了「会伸缩的搜索框」，5.7/5.8 治了「锚定右边的按钮」—— **两个都是症状**。任何占满宽度的东西（卡片、简介折行）都会跟着 8px 抖，而卡片占满宽度是改不掉的。

**根因**：`.options`（`ui-settings-general` 的滚动区，`overflow-y:auto`）在名册非空时有滚动条、清空时没有，**内容框宽度差 8px**（`--dsh-scrollbar-width: 8px`，实占不是覆盖式）。

**这次上两层互不依赖的保险**，任意一层生效就够了：

```css
/* 1. 让滚动条永远画出来：section 永远比容器内容框高 1px */
.aall-section{ min-height:calc(100% + 1px) }

/* 2. 让容器自己预留 gutter */
:has(> .aall-section){ scrollbar-gutter:stable }
```

第 1 层是主力，**它不碰 `scrollbar-gutter`、也不碰宿主的类名** —— 只要求滚动容器有确定高度（模态里的滚动区必然是），而 `100%` 万一解析不出来，声明会被直接丢弃，不会帮倒忙。

**关于 `:has()` 那条选择器**：这次回读 harness 源码确认了 DOM 层级 —— `renderEntry()` 返回的是 `<Comp {...props} />`（`scoped-slots.tsx:508-521`），`RootEntry` 只是转调，`SlotErrorBoundary` 是类组件 —— **中间确实没有任何包装元素**，`.options` 就是 section 的直接父节点。所以选择器本身是对的；上次没生效更可能是测的是旧包。但现在它只是第二层保险。

宽度定住之后，页头按钮才**重新右对齐到卡片的右边缘**（`flex:1 1 260px` + `margin-left:auto`），这是用户明确要求的。

**已由用户实测确认**（2026-09-13）：卡片不再抖动，页头按钮停在卡片右边缘上。

若日后又出现同类抖动，剩下的两手：**把内容列宽写死**（用户已授权），或者**让 section 自己成为滚动容器**（`height:100%` + `overflow-y:auto` + 自己的 `scrollbar-gutter:stable`，内外两层宽度同时锁死，代价是名册在面板内部单独滚动）。

**同时值得记住的教训**：连续三轮都在这一个 8px 上打转，前两轮分别治了「会生长的字段」和「右锚定的按钮」—— 都是症状。**只要容器内容框的宽度会变，任何占满宽度的东西都会抖**，应该第一轮就去锁宽度。诊断时先问「什么东西的尺寸在变」，而不是「哪个元素在动」。

## 5.10 专家头像：规格、交付、接入（2026-09-13，已完成）

用户决定**替换卡片左上角的圆形头像**（原来是各专家 frontmatter 里的 emoji），按**专家**提供，共 **279 张**。

**范围限定**：用户明确说"只优化卡片中的图片，其他的地方都不动了" —— 所以**插件里那 4 个 UI 图标（`SparkIcon` / `EyeIcon` / `CopyIcon` / `PlusIcon`）保持现状**，没有一起换。

### 一个决定性约束：必须内联

浏览器那一半**读不到 `assets/`**（那是宿主磁盘上的，客户端只能通过 RPC 拿数据）。所以 279 张只能**内联进客户端包**，这就锁死了格式：279 张 SVG 约 220 KB 可以接受，同样数量的 PNG 是几 MB —— **走不通**。SVG 是硬要求，不是偏好。

### 交付与校验

素材来自 `G:\dsh\图标\avatars-sticker-20260913`（手绘贴纸风格：粉彩填充 + 深棕描边 + 奶油色高光边）。**实测全部达标，且好于规格**：

| 我的要求 | 实际 |
|---|---|
| 文件名 = slug，279 个 | **279 / 279 精确对应**，无缺无多 |
| 总体积 ≤ 600 KB | **217 KB** |
| 单文件 ≤ 2 KB（硬上限 5 KB） | 最大 **1434 B**，平均 797 B |
| 正方形 `viewBox` | 全部 `0 0 48 48` |
| 禁用元素 | 一个都没有 |
| `id` 属性 | **一个都没有** —— 279 个内联也不会撞名，省掉了命名空间那一步 |

**授权：用户确认是 AI 生成**，已记入 `NOTICE` 第 3 条（Apache-2.0，与源码一致）。

### 接入方式

| 东西 | 作用 |
|---|---|
| `assets/avatar/*.svg` | **源**：279 个素材，**不进 git，只留本地** |
| `scripts/avatars-inline.mjs` | 生成 `src/client/avatars.ts`（slug → `data:image/svg+xml,…`）。**没有素材树时写出空模块** |
| `pnpm avatars:inline` | 重新生成（`typecheck` / `test` / `verify` 会各自先跑它） |
| `pnpm avatars:check <目录>` | 校验一批交付：缺 / 多 / 超限 / viewBox / 禁用元素 |
| `pnpm avatars` | 重新生成 `docs/AVATARS.md`（规格 + 清单） |
| `pnpm verify` 三条门禁 | ① 生成文件与素材树一致（两边都成立）② 每张图都能对上名册 ③ 数量与本地素材树相符 |

**三个关键决定**：

1. **素材不进 git 仓库。** 用户要求头像只留本地。`assets/avatar/` 与 `src/client/avatars.ts` 都写进 `.gitignore`，从索引移除、磁盘保留。**干净检出没有它们也能构建** —— `pnpm avatars:inline` 在没有素材树时写出一个合法的空模块，所有卡片回退 emoji。**已实测**：移走素材树 + 删掉生成文件后，四道门禁仍然全绿，`verify` 如实报告 `0 / 0`。
   - 生成文件**必须**存在（`src/client/index.ts` 是静态 import），所以它不能靠"记得先跑一步"：`typecheck` / `test` / `verify` 三个脚本各自先跑生成器，`vitest.config.ts` 还加了 `globalSetup`，让裸 `pnpm exec vitest run` 也能用。
   - `lib/` 本来就在 `.gitignore` 里，所以**构建产物里内联的头像同样不进仓库** —— 已核对：`git ls-files lib` 为 0。
   - 发布包也不带素材：`files` 加了 `!assets/avatar`。运行时没有任何东西读那棵树（只有构建脚本读），带上就是 222 KB 死重。
2. **在生成时就把 SVG 转成 data URI，不在渲染时转。** 卡片只做一次查表。
3. **`encodeURIComponent` 是必须的，不是洁癖。** 素材用 `#RRGGBB` 上色，**未经转义的 `#` 会开启 URL 片段、把图片从第一个颜色处截断**。测试里有一条专门断言 `src` 里不含裸 `#`。

**渲染**：`<img src="data:…">`，不是内联 DOM —— 不需要 `dangerouslySetInnerHTML`，而且 SVG 作为 `<img>` **不能执行脚本**。**无图回退 emoji**，所以上游以后新增专家不会出现空白。

**体积**：`lib/client.js` 从 **250 KB → 625 KB**。生成文件本身 362 KB（比 222 KB 原始素材大 63%，因为 `encodeURIComponent` 会把 `<` `>` `"` `=` 全部转义）。对一个本地插件可以接受；换掉它是后面的事。

**尺寸**：头像列宽 = 素材自己的 `viewBox`（**48px**），所以每张贴纸都是 **1:1** 绘制，不做重采样。这个尺寸还恰好等于身份列的自然高度（名字 22px + 4px + 分区/徽章 18px），所以头部**没有变高**。窄屏降到 40px。

**已确认**：用户在**深色主题**下看过，奶油色描边起到了贴纸分隔作用，效果正常。

## 5.11 `@` 引用发送失败：source 名对不上（2026-09-13）

用户做**真实召唤测试**时报错：

```
slash: no serializer for reference source "dsh-agency-agents-ll:academic"
```

**这是主路径上的真 bug，而且藏得很深：插入一切正常，只有发送才炸。**

**根因**在宿主 `ui-input-trigger/src/client/controller.ts:300-306`：

```ts
serializeReference(source, ref, signal) {
  const owner = this.deps.roster.all().find(s => s.name === source)
  if (owner?.codec === undefined) {
    return Promise.reject(new Error(`slash: no serializer for reference source "${source}"`))
  }
  return owner.codec.serialize(ref, signal)
}
```

它用 **source 的 `name`** 反查 owner。而我们两处写的不是同一个字符串：

| 位置 | 值 |
|---|---|
| 注册的 source | `name: \`${PLUGIN_ID}:@\`` → `dsh-agency-agents-ll:@` |
| 插入的引用 | `source: referenceSource(division)` → `dsh-agency-agents-ll:academic` ❌ |

**按分区做 source 是设计错误** —— 当时想着"每个分区一个 source id"，但宿主只按 source 名找 owner，分区与它无关。

**修法**：名字收敛成一个常量，两处共用；`referenceSource(division)` 整个删掉。

```ts
const SOURCE_NAME = `${PLUGIN_ID}:@`   // 注册用它，每个引用也携带它
```

**注意行为**：owner 找不到时是**拒绝整个提交**，不是静默降级 —— 所以这个 bug 表现为"发不出去"，而不是"发出去了但没效果"。

**回归测试**钉的是那个**关系**而不是某个具体字符串：`buildReference(experts[0], 'zh').source === 注册的 source.name`。这类断言必须在旧代码上先确认会红，否则它只是装饰。

**遗留**：改 source id 意味着**旧草稿里已存在的引用芯片会失效**（它们带着旧的 `…:academic`）。本地插件、刚踩到，不做迁移。

## 5.12 首次真实召唤：两个专家找出 4 个真问题（2026-09-13）

用户发起 `@文化人类学家 @品牌守护者` 的真实召唤（见第 3 节）。两个专家各拿到一个**自己领域内的真实任务**，不是空跑：

- **文化人类学家** → 审查 `assets/{zh,en}/academic/` 的 6 份档案：中文名是否准确传达学科角色。
- **品牌守护者** → 审查 `README.md` / `NOTICE` / `package.json description` 三处的对外表述一致性。

### 品牌守护者：5 条指控，4 条属实

| 指控 | 核实 |
|---|---|
| README 分区列表与 `src/names.ts` 不符 | ✅ 只列 15 个（漏付费媒体/研究/专业），且「市场」「地理信息」被简写成「市场」「GIS」 |
| README 状态停在 P0–P4 | ✅ P6 头像已完成 |
| README 门禁表只列 10 项却说 12 项 | ✅ 漏 `manifest-coverage` 与 `slug-sets` |
| `docs/AVATARS.md` 仍是交付前口吻 | ✅ 仍写 36×36 渲染、id 需要构建时加命名空间、可分批交付 —— 三条全过期 |
| **`list_experts` 的名称随界面语言切换** | ❌ **误报**。`displayName` 恒优先返回中文名；随界面语言变的是**分区标签**。而 README 说的是「不随**提示词**语言变化」，两者不是一回事 |

**四条属实的已全部修掉。** 误报那条特意记在这里：**一次自信的误报和一次正确的发现同样有价值** —— 它说明这类报告必须逐条核实，不能直接转述。

### 文化人类学家：分析准确，但基本不是我们能改的

它的发现质量很高（指出「定量研究统计学家」的实际内容是研究方法论与因果推断，不是统计学；指出「叙事学家」的内容实为编剧理论；指出「学术」这个分区按机构属性命名、而兄弟分区按行业命名，两把尺子）。**但这些几乎全部是上游设计**：

- **英文档案**是上游 `ad9264e` 的逐字节快照，`pnpm check` 硬核对，**一个字都不能改**（D3）。
- **分区集合**同样是上游的 18 个，我们刻意不做增删（D2）。
- 中文名是我们的，但把「定量研究统计学家」改成更贴合内容的说法，会让它**与英文原名 `Statistician` 脱钩**，反而破坏名册的双语对应。

**结论：这份报告是对上游素材的外部解读，不是缺陷清单。** 留着作为「如果哪天要向上游提 issue」的素材，不在本项目内处理。

## 5.13 召唤菜单点外面不关（2026-09-13）

用户报告：点输入栏的「专家」按钮弹出菜单后，**点空白处菜单不消失**。

**根因**：`ComposerButton` 只有触发器自己的 `onClick` 能关它 —— 既没有「点外面关闭」，也没有 Escape。而那个菜单是 `position:absolute` 盖在输入框**上方**的，指针自然要去的地方正好被它挡住。

**修法**：补两个出口，做法与宿主 `dsh-plugin-desktop` 的重启菜单一致：

- `document` 挂 `mousedown`：`event.target` 不在包裹元素内就关闭
- `document` 挂 `keydown`：`Escape` 关闭
- 只在 `open` 时挂，关闭时摘掉

用 `mousedown` 而不是 `click`：它先于 `click` 触发，所以点触发器本身时先判定「在内部、不关」，再走 `onClick` 取反 —— 不会出现「开了立刻又关」的竞态。

**回归测试**：三条新断言，其中两条**在旧代码上必失败**（实测 `2 failed | 1 passed`）。第三条「点菜单内部不该关」在旧代码上通过是对的 —— 没有处理器时它确实永不关闭。

**顺带修的**：测试用的假 ctx 以前只跑 `settings.section` 的注入回调，**根本注册不到输入栏按钮** —— 所以这个组件此前一条测试都没有。现在两个槽位都跑。



## 5.14 自动更新：本机已是全自动，缺的只是 watch（2026-09-13）

用户问「如何自动更新这个插件」。查清后发现**本机根本不存在"更新"这一步**，因为 profile 是以 **junction** 指向仓库的：

```
C:\Users\LL\.dsh\profiles\desktop\node_modules\dsh-agency-agents-ll
  → Junction → G:\dsh\dsh-agency-agents-ll
```

DSH 看到的就是仓库本身。剩下的唯一问题是**重建后 DSH 会不会重新加载** —— 会，两个半边都有热重载，**profile 里默认就开着**：

| 半边 | 机制 | 行为 |
|---|---|---|
| Host（`lib/index.js`） | `@deepseek-ai/cordis-plugin-hmr`（`launchWatchMs: 1000`） | 文件变化后重载插件 |
| 浏览器（`lib/client.js`） | `@deepseek-ai/dsh-client-hmr`（`pollIntervalMs: 500`） | 轮询 bundle，**原地热替换，无需刷新** |

**所以缺的只是一个 watch 进程。** 新增 `pnpm dev`（`avatars:inline && tsdown --watch`）：

```
改源码 → tsdown 自动重建 → DSH 自动热重载两半 → 界面上直接看到
```

**已实测**：watch 启动后改一行 `src/client/index.ts`，`lib/client.js` 约 4 秒后重建（21:57:13 → 21:57:17），还原后再次重建。
**顺带得到的证据**：这次重建发生在**本会话运行中**，宿主与浏览器两半都被重载，而我这个 agent 的会话没断 —— 说明热重载对运行中的会话是安全的。

**不能自动的两件事**（要分清）：

1. **上游新增专家**。见 **5.15**：新增了 `pnpm sync:upstream` 一条龙，能自动到**「拉取 + 点名」**，**不能自动到「补齐」** —— 中文名 / 一句话简介 / 中文简介 / 头像仍然要人写。
2. **别的机器上更新**。junction 是本机的；换机器要 `npm publish` 后由 `dshmarket` 更新。从本机发布时 `lib/client.js` 里已内联头像，而 `assets/avatar` 被 `files` 排除，所以包里有图、没素材。

**两个注意**：热替换会丢弃被重载插件内的 React 状态（例如正在编辑的自定义专家草稿）；`pnpm dev` 不跑 typecheck，提交前仍要 `pnpm build`。



## 5.15 上游内容更新流程：`pnpm sync:upstream`（2026-09-13）

用户问「我的上游专家来源新增了专家，我这里要怎么更新」。查清后发现**两条坑叠在一起，会让「上游更新了」完全静默**：

1. **`sync/sync.mjs` 从不 pull。** 它只读取它找到的 checkout（`sync/.cache/agency-agents` 或 `G:\dsh\agency-agents`），拷完报成功。checkout 是旧的，同步出来的就是旧内容，**看不出任何异常**。
2. **新增专家不是门禁失败。** `checks.mjs` 的 `HARD_FAILURE_CHECKS` 里没有 `missing` —— 没有中文档案的专家会降级为英文人设，只计入 `missing`。所以上游加了三位专家、这边一个字没写，**`pnpm check` 照样 12 项全绿、退出 0**，stdout 只有一行 `missing files (3): listed in sync/report.json under piles.missing`，key 藏在 JSON 里。

> **所以 5.14 里「`pnpm check` 会精确报出缺哪些」是错的**：它报的是**数量**不是清单，而且不构成「需要处理」的信号。补上这个缺口的就是本节。

### 加了什么

| 文件 | 改动 |
|---|---|
| `sync/sync.mjs` | 新增 `--pull`（`git fetch` + `--ff-only` 快进）。**默认仍然离线**，但会对比上次 fetch 留下的 `origin/main` 引用，落后就打印 WARNING。另外把写死的 `expected = 279` 换成与上一份 manifest 的**逐 key 差量**（`roster: 279 -> 281` 并逐个点名）—— 那个常量本来每加一位专家都得手改 |
| `sync/authoring.mjs`（新） | 把差异分成六类，逐个点名**确切的文件路径**，并写出 `sync/authoring.json`。有待办时退出 1 |
| `sync/upstream.mjs`（新） | 一键驱动：pull → sync → authoring → check，末尾给汇总表 |
| `scripts/avatar-manifest.mjs` | 头像 brief 里「目标 ≤ 600 KB（279 张合计）」改为派生自 `rows.length` —— 名册一涨那行就是错的。当前输出不变，所以 `docs/AVATARS.md` 没有 diff |

**命名**：`pnpm update` **不能用** —— 那是 pnpm 的内置命令（`up` 的别名），同名脚本会被内置命令盖掉。故选 `sync:upstream`（与 `sync` / `sync:stamp` 同族），报告单独跑是 `pnpm authoring`。
**为什么驱动是 node 而不是 package.json 里的 `&&` 链**：authoring **正是「有待办」时退出非 0**，`&&` 会让后面的门禁永远跑不到；而且 shell 链在 Windows 上要换语法。

### 六类判定

`enOutOfSync`（英文资产落后）、`divisionDrift`（分区集合变了，**要改三处代码**）、`missingZh`（缺中文档案）、`staleZh`（英文变了、译文基于旧版）、`unstamped`（没盖 `sourceSha256`）、`removedUpstream`（上游删了、本地还在）。**头像单独列且不计入待办** —— emoji 是文档承诺的兜底，素材允许分批交。逐条含义与处理方式见 [`UPDATE.md`](UPDATE.md)。

### 怎么验证的

在 `%TEMP%` 下用 `robocopy` 复制出真实上游工作树 → `git init` → bare server → 两个 clone，搭出一套带远端的模拟上游，然后逐个触发（全部命中）：

| 模拟动作 | 结果 |
|---|---|
| 上游提交了新专家，但从不 fetch | `pnpm sync` 报「无变化」——**这就是第 1 条坑，实测复现** |
| 只 `git fetch`（引用动、HEAD 不动）后再 `pnpm sync` | 打印落后 1 个提交的 WARNING |
| 手动快进 checkout、不跑 sync | `enOutOfSync` 点名 `engineering-backend-architect` |
| `pnpm sync:upstream` | `1 new commit(s) on origin/main; fast-forwarding`，`e08e10278a27 -> 213d579607e3`，`roster: 279 -> 281` 并逐个点名 |
| 上游在已有分区加一位专家 | `missingZh` 带 name / emoji / description / 目标路径 |
| 上游新增 `quantum` 分区 | `divisionDrift` 提示三处登记 |
| 上游改了已有专家的人设 | `staleZh` 点名；门禁 `translation-freshness` 只是 **WARN**（该档案是 intro-only），11 项 PASS / `missing: 2` |
| 手动抹掉某档案的 `sourceSha256` | `unstamped` 点名，待办 4 → 5 |
| 上游删掉一位专家 | `removedUpstream` 点名要删的两个文件；门禁 `english-byte-identity` **FAIL** + `manifest-coverage` **FAIL**，`suspect files` 里出现该专家 |
| 新专家还没配头像 | 列在可选区、不计入待办，文案提示 emoji 兜底 |

验证后仓库已还原到 279 基线（`assets/en` 与 `sync/manifest.json` 由 git 恢复，`assets/en` 下未跟踪的新增用 `git clean -fd assets/en` 清掉；预演过 `git clean -fdn` 才执行）。

### 已知限制（写进文档了，不是待办）

**离线的 `pnpm sync` 无法知道上游动没动。** 它只能对比**上次 fetch 时**留下的 `origin/main` 引用：落后于这个引用会告警，但这个引用本身旧的话它无从判断 —— 「远端有没有新提交」必须联网才知道。所以**想知道上游有没有新专家，就跑 `pnpm sync:upstream`**。让 `pnpm sync` 保持离线是刻意的：同一个命令在没有网络的机器上仍然产出同样的字节。

### 踩到的两个工具坑（都是老坑的新实例）

- **`& $exe script.mjs` 对 GUI 子系统程序不等待。** 第一次跑驱动时输出为空、`$LASTEXITCODE` 是 0，看起来像「驱动没输出且成功」，实际是 pwsh 提前走人、子进程被掐死在「已 `git merge` 完但还没拷文件」的中间态 —— checkout 被移动了，`assets/en` 却没动。**要等就用 `Start-Process -NoNewWindow -Wait -PassThru -RedirectStandardOutput <文件>`**，日志再用 read 工具看（`Get-Content` 会把 UTF-8 中文按 ANSI 解成乱码）。
- **`Select-Object -First N` 会提前掐断上游管道**，把被包装的进程一起杀掉，于是退出码变成 1、输出被截断。要么 `-Last N`，要么先赋值给变量。

## 5.16 仓库被 git 悄悄改成 CRLF，门禁全红（2026-09-13）

5.15 的验证过程中，为还原被模拟上游改动的文件跑了 `git checkout -- assets/en`。之后 `git status` 说工作区干净，`pnpm check` 却报：

```
HARD FAILURES (3):
  [english-byte-identity] engineering/engineering-backend-architect: en hash 1e7c00a9867b differs from the manifest baseline 18f237d054fa
  [english-byte-identity] engineering/engineering-backend-architect: en is 11164 bytes, the manifest recorded 10928
  [english-byte-identity] engineering/engineering-backend-architect: en no longer matches the upstream checkout; re-run pnpm sync
```

**根因**：`core.autocrlf = true`，来源是**系统级** gitconfig（`C:/Program Files/Git/etc/gitconfig`）—— 也就是 Git for Windows 的默认值。`git checkout` 会把 blob 里的 LF 写成 CRLF。而 `git status` **看不见**：它比较时会把 CRLF 归一化回 LF。于是「看起来干净、字节全错」。

**这不只是还原时手滑。** 决定性验证是把仓库 clone 到干净目录再量 `assets/en`：

| | 修复前 | 修复后 |
|---|---|---|
| clone 后含 CRLF 的英文资产 | **279 / 279** | 0 / 279 |
| 与上游大小不符 | **264 / 279** | 0 / 279 |
| clone 里 `pnpm check` | **exit 1** | exit 0 |

也就是说：**仓库当时的状态，在任何标准 Windows Git 上 clone 下来都过不了自己的门禁。** 只有本机这个工作区是好的 —— 因为 `assets/en` 是 `sync.mjs` 用 `copyFile` 拷进去的，绕过了 git，而 `git checkout` 一旦碰过其中某个文件就会把它变成 CRLF。

### 修法

新增 `.gitattributes`，把两棵资产树钉成 `-text`：

```
assets/en/** -text
assets/zh/** -text
```

**必须是 `-text`，不能是 `eol=lf`。** 上游本来就有 15 个文件是 CRLF；`eol=lf` 会把它们翻成 LF，反而破坏要保护的那个「逐字节一致」。`-text` 的含义是「原样，两个方向都不转换」。

顺带用 `git add --renormalize .` 把两个 `LICENSE` 重新入库：它们的 blob 之前是 LF、磁盘是 CRLF（commit 时被归一化掉了），现在 blob 与上游逐字节相同。

### 同一病根的第二处：`sameManifest`

`sync/sync.mjs` 头部声明「连跑两次磁盘不变」，做法是剥掉 `fetchedAt` 再比字符串：

```js
text.replace(/"fetchedAt": "[^"]*",\n/, '')
```

`git checkout` 写出来的文件是 CRLF，`,\r\n` 匹配不上这个模式 → 内容其实没变的 manifest 被判为「变了」并重写。修法是比较前先归一化行尾：

```js
const strip = (text) => text.replace(/\r\n/g, '\n').replace(/"fetchedAt": "[^"]*",\n/, '')
```

**已实测**：把 manifest 人为弄成 CRLF（83104 字节）后跑 `pnpm sync`，前后 sha256 完全相同（`2F352AAA24ABFAA0…`）；修复前它会重写。

### 教训

`git status` 干净**不等于**磁盘字节没被 git 动过。只要文件带哈希或字节一致性契约，就必须把它从 git 的行尾转换里摘出来，而且验证方式必须是**量字节**，不是问 `git status`。这个缺陷是被「模拟上游之后还原」这个动作顺手炸出来的 —— 如果没做那次演练，它会一直潜伏到某台新机器 clone 时才爆。

## 5.17 「我怎么知道有更新」：`pnpm upstream:check` + 每日监视（2026-09-13）

用户接着问「那我现在怎么知道有更新呢」。5.15 做的全都是**拉**模型 —— 不跑就不知道；而 `sync:upstream` 会拉取并写盘，为了「看一眼」去跑它并不合适。补了两层。

**`sync/upstream-check.mjs`（新，`pnpm upstream:check`）—— 只查，不写盘：**

1. `git ls-remote <repo> HEAD`，一次请求、零磁盘。与 `sync/manifest.json` 记的基线一致就直接结束：实测 **2.1 秒**，连缓存目录都没建。
2. 只有远端动了，才浅克隆到 `sync/.cache/upstream-probe-<仓库哈希>/`，把它那份名册与 manifest 逐位比对，报出新增 / 改动 / 删除的专家与分区变化。

退出码 `0`（没变）/ `1`（变了）/ `2`（**没查成**）。**`2` 绝不能被当成「没变」** —— 监视坏掉的那天，那样会让你以为天下太平。

**`.github/workflows/upstream-watch.yml`（新）——** 每天 01:23 UTC 在 GitHub 自己的机器上跑一次：名册变了就开 issue（正文由 `--markdown` 生成，GitHub 邮件通知你），没变就关掉遗留 issue，**查不动就让工作流失败**。注意 GitHub 会在仓库 60 天无活动后暂停 schedule 工作流（暂停前会通知）。

### 写这个脚本时踩到的两个坑

**① 探测缓存必须按仓库区分。** 第一版用固定目录 `sync/.cache/upstream-probe`。测试时我把 manifest 指向另一份模拟上游，它却照样去 fetch **旧**仓库（`origin` 还指着旧的），于是给出一个**看起来完全合理**的错误答案 —— 我第一反应是「测试用例写错了」，实际是脚本在静默答错。改成目录名带仓库哈希（`upstream-probe-<sha256(repo) 前 8 位>`）之后，换远端天然换目录，连「检测并删除陈旧缓存」这条易碎逻辑都不需要了。

**② Windows 上 `fs.rmSync` 删不掉一个 git 仓库（EPERM）。** git 的对象文件是只读的。给「损坏缓存」准备的重建路径必须先把只读属性清掉再删（脚本里的 `removeTree`）。

### 它被验证到什么程度

`upstream:check` 四个分支都真跑过：真实 GitHub 上游（0）、名册与基线一致但远端有新提交的副本（0）、含 4 类改动的模拟上游（1）、不存在的远端（2）。

工作流的 shell 逻辑用**桩 `gh`** 在本地 Git bash 里跑了五个用例，断言每次的调用序列：无 issue 时 create；正文相同则**不 edit**（否则每天骚扰你一次）；正文不同才 edit；名册没变时 close；都没有则什么都不做。YAML 用 pnpm store 里的 `js-yaml` 解析并断言了结构（两个分支条件互斥且完整、`probe` 步骤确实写 `GITHUB_OUTPUT`）。

**工作流本身也已在 GitHub 上真跑过**（手动 dispatch 两次）：`watch in 6s` / `9s`（run `34762632756`、`34762673007`），日志里是 `upstream:check 退出码 = 0`、未开 issue、未改任何东西。第一次跑带出 `actions/checkout@v4` / `setup-node@v4` 的 **Node 20 弃用注解**，已升到 `@v7` 并复跑确认注解消失。job 里钉 Node 22 是刻意的 —— 它是 `engines` 的下限，在最老的受支持版本上跑通才说明脚本没有偷偷依赖新版本。

## 5.18 2026 代码评审与整改

**前提**：这是一轮三路代码评审（领域评审员 + 工具链评审 + 队长逐条独立复核）之后的整改。**评审当时门禁是全绿的**（63 tests / 12 checks / 34 verify），所以下面每一条都是**门禁覆盖不到**的地方，而不是"忘了跑门禁"。

### 四类根因

1. **真源分裂（blocker）**：浏览器半边早就支持自建专家与启用停用，而 4 个工具仍只读磁盘名册——新建一位专家在 UI 里全程可行（创建、启用、`@` 插入），**唯独最后一步召唤必然失败**。`Config.enabled` 的注释还写着"Slugs the roster offers to the model"，与实现相反。63 条测试里没有一条走完这条主路径。
2. **门禁自报状态与自身判定脱钩**：`slug-sets` 的 `status` 是字面量 `'pass'`；`english-byte-identity` 的 `status` 不含它自己产生的硬失败。同一次运行可以既打 `PASS` 又列 `HARD FAILURES`——退出码是对的，机器可读的那一份（`report.json`）在撒谎。
3. **5.16 的残留**：`.gitattributes` 钉住了两棵资产树，**漏了 `sync/manifest.json` 自己**。`sameManifest()` 先归一化行尾再比较，于是它永远看不出该文件已与 git blob 差 1784 字节，也永远不会自愈。
4. **用户态数据被静默改写**：名字一冲突，投影就把 slug 从 `enabled` 里剔掉（下一次点任意开关即永久落盘）；写入以"本版本能解析的条目"整体替换 `customExperts`，读不出的条目被顺手删除。

### 报告里三条不成立（逐条复核后推翻）

| 报告条目 | 复核结论 |
|---|---|
| `upstream.mjs` 的 mtime 守卫可能把上一轮的旧报告当本轮结果 | **误报**。`startedAt` 在三个步骤之前取得，报告给的那个触发场景（"本轮 authoring 在写出报告前崩了"）恰恰是守卫**正确处理**的场景：此时磁盘上的报告必是上一轮的，mtime < startedAt，守卫判"报告未生成" |
| BOM 处理不一致 ⇒ "manifest 说过期、门禁说新鲜" | **结论错**。`checks.mjs` 把 BOM 报成 `frontmatter` **硬失败**，门禁会红、不会静默放行。真实缺陷只是"四个读者三种行为"，范围因此收窄 |
| "新分区要改三处"应为"至少六处" | **错**。多出来的四处（头像体积文案、简介区间、README 计数、`AVATARS.md`）与分区登记无关。真实登记面就是 `src/names.ts` / `sync/glossary.json` / `scripts/verify.mjs` 三处 |

三条都在对应工作流动手前发出更正。这与 5.12 记下的那条同源：**一次自信的误报和一次正确的发现同样有价值**——所以复核不能省。

### 报告没覆盖、由新回归测试挖出来的两条

1. **`root` 配置从来没有可用过。** `resolveAssetRoots` 把 `root` **同时**当成 en 与 zh 两棵树，于是同一个文件的 `name:` 同时充当英文名与中文名——D3（英文上游是名册唯一真源）在 `root` 非空时直接失效。该行随 P3 的原始提交 `495d112` 进来，全仓库对布局只有一句注释，且不存在第二种自洽读法（格式是"一个文件一个 `name:`"）。已改为"`root` 是装着 `en/` 与 `zh/` 的目录"，并把布局写进注释。**它是被"自建专家 → summon → 命中 persona"那条端到端断言逼出来的。**
2. **写入路径会删掉自己读不出的数据。** `readCustom()` 原本整份数组一起 parse（一条坏 ⇒ 全丢），而 `saveCustom` / `deleteCustom` 以它为准整体回写：任何本版本读不出的条目（未来版本写的、手工改坏的）都会在下一次无关写入时被静默删除。已改为 `restate()`——以**原始数组**为基准只动目标 slug，其余（含读不出的）原样带过。同一类的第二处：`validateRosterSettings` 原来对"容器不是数组"抛错，而它在**注册期**被调用，于是手改坏一个字段会让命名空间永久注册失败、页面永远显示"请稍后重试"。现在容器也降级为记录 + 按空处理。

**新契约：读取可以降级，写入绝不丢数据。** 一句话：坏数据只在它自己那一格降级，且必须被记录，绝不由无关操作顺手清理。

### 数据修复

两位专家共用中文名 `电商购物车工程师`：`engineering-drupal-shopping-cart` 改名 **`Drupal 电商购物车工程师`**，`engineering-wordpress-shopping-cart` 改名 **`WordPress 电商购物车工程师`**（各自贴合英文原名）。原本的运行后果：两张卡的开关永久点不动（`disabled: pending || conflict`）、按中文名召唤报歧义、且用户此前对它们的启用标记会在下一次点任意开关时被静默抹掉。

### 新契约（已写进 PLAN 的决策表）

- **D17**：4 个工具面向**完整名册**（出厂 279 + 用户自建）；`enabled` **只治理浏览器侧**，不过滤任何工具。理由是 `enabled` 的工厂默认是 `[]`，拿它过滤工具会让全新安装的 `list_experts` 返回 0 位专家。
- **D18**：用户态数据不得被静默改写；**冲突不禁用卡片开关**——Host 现在保留冲突 slug，若客户端仍禁用，一位已启用的专家会被困成"勾着、点不动"，而那是 D18 自己引入的陷阱。冲突只由徽章说明、并由 `@` 候选拒绝（mention 只带名字，放进去等于生成一个注定解析失败的引用）。

### 门禁变化

- **12 项 → 13 项**：新增 `name-uniqueness`（**硬失败**）。中文名必须全局唯一——运行时要按名字解析专家，同名会让按名召唤歧义、让两张卡的开关永久禁用。这条不变量此前只靠人记得。
- **`intro` 区间由 40–600 收紧为 120–400 汉字 + 3–8 句**。原区间比实测（151–314 汉字、3–6 句）低 3.8 倍、高 1.9 倍，它声称要抓的"像占位"与"像贴了一整篇"两种形态**都放过了**；句数约定 PLAN 里写了但从来没有门禁执行。
- `sync/corpus.mjs`（新）：四个脚本共用一套 frontmatter 读取与度量。此前 `checks.mjs`（执行者）量的是 `stripMarkup` 之后的文本、`calibrate-ratio.mjs`（校准者）量的是原文——**照校准器的输出调阈值就等于调错**；四个读者的 BOM 规则也各不相同。
- 门禁自报状态一律由该检查自己的 notes/drift 推导（`statusFor()`），手写条目与 `summarize()` 不可能再分叉。

**门禁现状见第 2 节。**

## 5.19 系统提示段落：让名册可被发现（2026-09-14）

**缺口**：4 个工具一直都在、一直都可用，但**没有任何东西告诉模型名册存在**——它们只是一长串工具里的 4 个 schema，于是实践中只有用户在输入框 `@` 某位专家才会真的发生召唤。grep 全 `src/` 可确认：这个插件**从来没有**往系统提示里写过任何东西（唯一提到 `system-prompt` 的地方是 `persona.ts` 的一句 JSDoc）。

**它原本打算做这件事**：最初的 `inject` 列表里写着 `systemPrompt`，还 import 了它的类型——但从未实现。5.18 整改时它被当成死代码删掉了（理由充分：全文件没人用）。本节把它恢复，并补上实现。

**设计决定（用户明确要求）**：**只在用户明确要求时才搜索和召唤专家。** 不要"这个任务看起来属于某个专业领域"式的自作主张。理由是成本：一次召唤 = 一次完整的子代理运行，花时间也花额度。

**实现**：

| 项 | 取值 / 做法 |
|---|---|
| 段落名 | `agency-agents-ll:roster`（带命名空间，避免与其他插件撞名） |
| 排序 | `getSectionOrder('TOOL_SUBAGENT')` = 2800 —— 紧挨子代理工具，因为这段话讲的就是"那个工具什么时候允许跑" |
| 文本 | **provider 函数**而非固定字符串，所以每次组装时按界面语言实时取值 |
| 语言 | zh / en 两份都在 `i18n.ts`，由 key 集对等门禁保证不缺 |

**文本里除了"名册在哪"，还必须写清三条"不要"**：不要自作主张召唤；不要为纯事实查询 / 小改动 / 需要快速来回迭代的事召唤；**评审类召唤必须给对方留「说没问题」的余地**。最后这条是两轮评审的直接教训——共提出约 43 条，其中 5 条经复核不成立，成因之一就是"必须交出一份完整评审"的压力。

**证据**：

1. **自动测试**（`src/index.test.ts` 新增 2 条）：断言段落被注册、排序为 2800、文本含关键约束、且**跟着界面语言变**；
2. **真机**：用户在 **3 个全新会话**里分别测试三个场景，行为均符合预期——不要求就不召唤，明确要求才搜索；
3. **段落确实进了系统提示**：可以在 agent 自己的系统提示里直接读到它，位置正好落在 ralph 与"子代理后台运行"两段之间，即 order 2800 处。

> **自动测试与真机测试的差别值得记一笔**：测试只能断言"这段文字被注册了"，**测不出"模型是否照做"**。后者只有新会话里的真实行为能证明——旧会话的上下文里可能已经有别的理由让模型知道名册存在。

**DSH 本体没有被修改**：这段提示是插件通过 `ctx.systemPrompt.section()` 这个**公开接口**在运行时投进去的，`app.asar` 的最后修改时间仍是 2026-09-10。所以：停用插件 → 提示立刻消失；改措辞 → 只改 `src/i18n.ts` 再重建；`lltest` profile 装了同一个插件，那边同样生效。

### 5.19.1 顺带查清的三件事

**① 这一段每轮花多少 token。** 实测（本机 `settings.yaml` 界面语言为中文，模型 `deepseek-flash`）：

| | 字符 | 估算 token |
|---|---|---|
| 中文版 | 364（228 个汉字 + 8 个工具名） | 约 250–350 |
| 英文版 | 898（155 个英文词） | 约 220–280 |

它在整轮提示里约占 **1–2%**。**而且内容是稳定的**（只有界面语言变了才变），所以它待在缓存前缀里，每轮边际成本接近零——见第 6 节的用量实测。

**② 谁在往系统提示里投稿。** 本机装的 11 个插件里只有 **3 个**贡献段落：

| 插件 | 段落 | 注册工具 |
|---|---|---|
| `@nanmicoder/dsh-agent-teams` | 1 | **13**（它那段"队长协议"是提示词里最长的一节） |
| `dsh-agency-agents-ll` | 1 | 4 |
| `@michengai/dsh-automation` | 1 | 1 |
| 其余 8 个（dshmarket / archive-manager / whale-widget / context / config-manager / skills-manager 等） | 0 | 0–1 |

**提示词的大头通常不是这些散文段落，而是工具 schema**（每个工具的说明 + 参数 JSON 都要进去）。所以"装插件会不会把提示词撑爆"要看**它注册多少工具**，不是看它有没有段落。

**③ 卸载插件时没人需要清理这段提示。** `ctx.systemPrompt.section()` 内部是 `layers.effect(ctx, …)` → `ctx.effect(…)`，而 Cordis 的 `Service` 有 tracker 机制，让 `this.ctx` 解析成**调用方**（也就是本插件）——所以这个注册**归插件所有**，插件一卸载就自动 dispose。官方注释也写明 "in the calling context's scope" / "the exact Cordis effect disposer"。

卸载后**唯一会残留**的是设置文档里那个命名空间（`%DSH_HOME%\settings.yaml` 的 `agency-agents-ll:`，装的是 `enabled` / `customExperts` / `promptLocale`）——那是偏好，不含任何提示词文本，重装即接着用。**而旧会话日志里仍留有当时那份系统提示**（见第 6 节），那是历史记录，不是活配置。

## 5.20 评审这件事本身：两轮实测的结论（2026-09-14）

本节记的不是代码，是**方法**——因为这个仓库接下来还会被评审，而这两轮的账很值得留。

### 账

| 轮次 | 形态 | 提出 | 经复核不成立 |
|---|---|---|---|
| 第一轮 | 全面评审（三路并行） | 约 40 条 | **3 条** |
| 第二轮 | 定向评审（只审 diff） | 3 条 | **2 条**（+1 条它自己撤回） |

而被推翻的三条（`upstream.mjs` 的 mtime 守卫、"新分区要改六处"、BOM 的"两个真源矛盾"）都**写得很有说服力**——误报比漏报更费时间，因为要花力气才能推翻它。

**更要紧的是另一半：那份报告漏掉的 2 条真缺陷（`config.root` 从来不可用、写入会删掉自己读不出的数据），没有一条是评审读出来的，全都是新写的测试逼出来的。**

> **结论：能变成可执行证据的，就不要留在"再看一眼"。** 评审的产出必须逐条复核后才采纳；测试的产出不需要（红了就是红了）。

### 为什么同模型评审靠不住

作者和评审是**同一个模型**时，双方共享同一套先验，于是"读代码"会退化成"按意图回忆代码"。第二轮里它**引用了一段仓库里根本不存在的代码**（`const lines = [expanded ? heading : brief]`）——具体、可信、不存在。这类错误作者与评审**互相看不见**，因为它不是"能力不足"，是**相关盲区**。

### 人设层面的观察（对自建专家有用）

`代码评审员` 的人设里有两条在**鼓励凑数**：

- **"要具体 —— 说'这会在第 42 行引发 SQL 注入'"**：把"给出具体行号"写成硬要求还配了例子。没真读代码的模型会倾向于**编一个像样的行号**，而不是说"我没核实"。
- **"赞美优秀代码" + "一次评审，完整反馈"**：合起来产生"必须交出一份看起来完整的评审"的压力。

它的价值在**形状**（优先级分级、位置+原因+建议的格式、一次到位、点名好东西），风险在这两条硬要求。想让评审更诚实，三处小改就够：

1. 把 *"要具体 —— 说'这会在第 42 行引发 SQL 注入'"* 改成 **"把你说的那段代码原样引出来；只有行号没有引用，等于一条你没核实过的断言"**——这一条就能挡住上面那两个误报；
2. 在评论格式里**给"我核实不了 X"一个正式位置**，而不是事后补一段存疑；
3. 把 *"赞美优秀代码"* 换成 **"点出一个你不想被弄坏的设计"**——保留价值，去掉凑数压力。

**但英文人设改不了**：`assets/en/**` 受 `english-byte-identity` 硬门禁约束（须与上游基线逐字节一致）。中文正文能改，但只有 `promptLocale` 为 `zh`/`auto` 时才生效；否则用**自建专家**写一个"证据审计员"最干净——存在设置文档里，不碰上游资产、不受门禁约束。

### 换模型这件事

本机只配了一个 provider（`deepseek-official` / `deepseek-flash`），所以"换个模型来评审"暂时做不到。但**不需要第二个模型也能拿到大部分收益**：

1. **把断言变成会失败的测试**（本轮已证两次有效）；
2. **换任务形状而不是换模型**：不问"这段代码有什么问题"（容易退化成回忆），而问"**给我一个输入，让这条注释变成假的**"——要求产出可执行的东西，很难靠回忆糊过去。

## 6. 环境要点（重开会话必读）

- **`core.autocrlf = true`（系统级 gitconfig 的默认值）会把 checkout 出来的文件写成 CRLF，而 `git status` 看不出来。** 见 5.16。`assets/en`、`assets/zh` 已用 `.gitattributes` 钉成 `-text`，但**其它文件仍会被转换** —— 今后任何「对字节有契约」的新目录都要一起钉住。要判断磁盘真实字节就用 `[System.IO.File]::ReadAllBytes`，别问 git。另外 `git checkout -- <file>` 对 git 认为「干净」的文件是**空操作**（这正是当时没能把它改回来的原因），要强制重写必须先删掉再 checkout，或者用 `-c core.autocrlf=false`。
- **`node` / `npm` 不在 PATH。** `pnpm`（11.8.0）与 `node` 都由 DSH Desktop 的 runtime shim 提供。
- **⚠️ 不要用 `pnpm` / `node` 的 `.cmd` shim 跑命令 —— 会弹出可见的 CMD 窗口，打断用户用电脑。**
  实测（2026-09-13，用户报告后测得）：一轮完整门禁走 `pnpm.cmd` 会拉起 **11 个 `cmd.exe` / 7 个 `conhost.exe`，其中 1 个带可见窗口**。静置对照是 0。
  **根因**：没有真的 `node.exe` —— `node.cmd` 只是设 `ELECTRON_RUN_AS_NODE=1` 再调 Electron；`pnpm.cmd` 同理。而 `pnpm run <script>` 还要为脚本再套几层 `cmd.exe`。
  **绕开办法：直接调那个 exe，跳过批处理**，实测 **0 / 0 / 0**：

  ```powershell
  $exe = "G:\deepseek harness\DSH Desktop\DSH Desktop.exe"
  $req = (Get-ChildItem "C:\Users\LL\AppData\Roaming\DSH Desktop\runtime-commands\generations\*\private\clear-env.cjs" | Select-Object -First 1).FullName
  $env:ELECTRON_RUN_AS_NODE = '1'
  & $exe --require $req scripts/verify.mjs        # 该等的时候用下面的写法
  ```

  各入口的真实路径：`node_modules/typescript/bin/tsc`、`node_modules/tsdown/dist/run.mjs`、`node_modules/vitest/vitest.mjs`，本仓库自己的脚本就是 `scripts/*.mjs` 与 `sync/*.mjs`。
  **两个坑**：① `& $exe` 对 **GUI 子系统**程序**不会等待**，退出码和输出都拿不到 —— 要等就用
  `Start-Process -NoNewWindow -Wait -PassThru -RedirectStandardOutput <文件>`；② 那个写法**不会给参数加引号**，路径里带空格（`DSH Desktop`）必须自己包 `"…"`。
  **注意**：项目的 npm scripts 本身不用改 —— 人在正常终端里跑 `pnpm build` 时，那些 cmd 窗口是正常的、也是预期的。这只影响「从隐藏控制台里跑命令」的场景。
- **Windows PowerShell 5.1 会把无 BOM 的 UTF-8 `.ps1` 按 ANSI 解码而乱码。** 含中文字面量的脚本必须先转成带 BOM 再执行（`run-all.ps1` 是现成范例）。
- **不要用 `pwsh` 内联 `pnpm exec node -e "…"` 跑含正则或引号的脚本** —— PowerShell 会把它解析坏；写成 `%TEMP%` 下的临时 `.mjs` 再执行。
- `dsh` 与 `pnpm` 的 shim 路径里含随版本变化的 `<hash>`，**脚本中不要硬编码**，用 `Get-Command` 解析。
- **工作区 `G:\dsh` 的现状**（2026-09-13 清理过，释放 187.7 MB）：只剩五项 —— 本仓库 `dsh-agency-agents-ll`、英文上游 checkout `agency-agents`、头像素材 `图标`、备份 `备用`、用户自写的 DSH 技能 `task-continuity`。
  **`agency-agents` 不能删**：`sync/sync.mjs`、`sync/authoring.mjs`、`sync/checks.mjs` 三处都硬编码了它作为默认上游。删了不会立刻坏（`sync.mjs` 会退化成浅克隆到 `sync/.cache/`），但会让每次同步都依赖网络。
  清理掉的是：第一轮被推翻的映射工程 `agency-mapping`、已弃用的中文上游 `agency-agents-zh`、参考实现 `dsh-agency-agents`、DSH 源码克隆 `deepseek-harness`、Git 安装包 `downloads`、上一轮的一次性网络探针 `gh-stability.mjs` / `.log` 与 DSH 的 `debug.log`。
  前四个都是**干净克隆、可重建**（动手前逐个量过：无未提交、无本地提交、无 stash），不是丢数据。
- `%TEMP%` 里可能有本轮会话留下的辅助脚本（`aall-*`），与本仓库无关，删掉不影响任何东西。
- **会话日志是「多帧 zstd」，而 Node 的解码器只解第一帧、还不报错。** 想从日志里取证（比如查用量、查某一轮到底发了什么），必须**按魔数逐帧解**：

  ```js
  // ❌ zlib.zstdDecompressSync(buf) 与 createZstdDecompress() 都只出第一帧
  //    （1.7 MB 的文件只解出 249 B，且不抛错）——这是本项目踩过的真坑
  // ✅ 按帧起点切开，逐帧解：
  const M = [0x28, 0xb5, 0x2f, 0xfd]                    // zstd magic
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] !== M[0] || buf[i+1] !== M[1] || buf[i+2] !== M[2] || buf[i+3] !== M[3]) continue
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(i)).toString('utf8')) } catch {}
  }
  ```

  会话在 `%DSH_HOME%\sessions\<工作目录转义>\<session-id>\session.v3.jsonl.zstd`。**日志里存着系统提示原文**（所以卸载插件后，旧日志里仍留有当时那一段——那是历史记录，不是活配置）**以及每轮的 `usage`**。
- **每轮的 token 用量可以直接从日志里读**，字段含义（实测一份）：

  ```json
  {"inputTokens":287, "outputTokens":155, "totalTokens":19386,
   "cacheReadTokens":18944, "reasoningTokens":61}
  ```

  | 字段 | 含义 |
  |---|---|
  | `totalTokens` | 该轮**发给模型的总量**（随对话增长；本会话从 16,435 涨到 25,079） |
  | `cacheReadTokens` | 走**上下文缓存**的部分（这一轮 18,944，占 97.7%） |
  | `inputTokens` | 按**新输入**计费的部分（这一轮 287） |
  | `outputTokens` / `reasoningTokens` | 输出与推理 |

  **推论：提示词确实每轮都发，但稳定的前缀走缓存，边际成本极低。** 所以"插件装多了每轮会被提示词吃光额度"这个担心**不成立**——真正要盯的是注册了多少**工具**（工具 schema 才是提示词的大头）。
- **教训一句**：**"扫不到"不等于"没落盘"。** 本项目的 agent 曾据此断言"系统提示没被记进会话文件"，错了两次——第一次用 `ReadAllText` 扫压缩文件，第二次用只解第一帧的解码器。**取证前先证明你的工具能看见全量**（打印解压后的字节数，和压缩前的比值对一下）。
- **提交信息不要带 BOM。** PowerShell 的 `Set-Content -Encoding UTF8` 会写 BOM，`git commit -F` 会把它带进 subject（本仓库历史上已有几条中招）。用 `write` 工具生成消息文件，或提交后按字节核对（`[System.Text.Encoding]::UTF8.GetBytes($subject)[0..2]` 不应是 `239,187,191`）。
- **`.gitattributes` 钉了 `-text` 的文件，git 可能凭空显示 `M`。** 若 `git diff HEAD --numstat` 为空、而 `git hash-object <file>` 与 `git rev-parse HEAD:<file>` 相同，那就是**陈旧的 stat 缓存**，`git add <file>` 刷新它即可，**不会暂存任何内容变化**。（2026-09-14 在 `sync/manifest.json` 上实测过。）

## 7. 常用命令

```powershell
cd G:\dsh\dsh-agency-agents-ll
pnpm build              # typecheck + tsdown（Host ESM / 客户端 ModuleLoader CJS）
pnpm exec vitest run    # 107 项：roster-settings 17 + remote 16 + host 40 + 客户端 jsdom 34
pnpm verify             # 35 项发布门禁
pnpm check              # 13 项机械门禁 → sync/report.json
pnpm sync               # 拉上游英文资产、刷新 manifest（幂等，离线）
pnpm upstream:check     # 上游名册动了吗？秒级、不写盘（0 没变 / 1 变了 / 2 没查成）
pnpm sync:upstream      # 上游更新一条龙：fetch+快进 -> 同步 -> 待办清单 -> 13 项门禁
pnpm authoring          # 只看待办：还需要人工补写哪些中文档案/头像（见 UPDATE.md）
pnpm sync:stamp         # 为中文档案盖 sourceSha256（从磁盘推导）
pnpm sync:calibrate     # 用本项目自己的译文对重测长度比区间
pnpm avatars            # 重新生成 docs/AVATARS.md（头像规格 + 279 行清单）
pnpm avatars:check <目录>  # 校验一批头像交付：缺/多/超限/viewBox/禁用元素
pnpm avatars:inline     # 由 assets/avatar 重新生成 src/client/avatars.ts
```

> **改完代码一定先跑 `pnpm build` 再跑测试，不要只跑 vitest。**
> `tsc` 抓到过一次 vitest 完全放行的错误：`createElement` 参数表少一个右括号时，`return A, B, C` 是合法的**逗号运算符**，整段尾巴被解析成兄弟表达式却仍然通过，组件照常渲染、测试全绿，只是 DOM 层级变了。详见 5.6。

安装 / 卸载（desktop profile）：

```powershell
dsh plugin --profile desktop add G:\dsh\dsh-agency-agents-ll
dsh plugin --profile desktop remove dsh-agency-agents-ll
dsh --profile desktop --dump-config      # 应见 agency-agents-ll 与 /remote 两行
```

隔离验证 profile `lltest`（`C:\Users\LL\.dsh\profiles\lltest`）同样以 link 方式装着本插件，改代码后无需重装即可验证，**不会影响 desktop**。

## 8. 门禁速查

`pnpm check` 的 13 项里哪些是硬失败（会让 exit code 非 0）：

| 硬失败 | 其余只计入 suspect |
|---|---|
| 中文档案必填 `name`/`description`/`intro`/`emoji` | 段落数与英文精确相等 |
| 简介 120–400 汉字、3–8 句 | 标题层级一致 |
| 英文逐字节对齐上游基线 | 长度比落在 `[0.7, 3.2]` |
| 代码围栏闭合 | 术语表一致性 |
| manifest 覆盖完整 | 正文无残留英文 |
| 中文名全局唯一 | 分区与 slug 集合一致 |
| 翻译新鲜度（**仅当该档案带正文**） | |

档案两种形态：`intro-only`（273 份，名册显示中文、召唤回退英文）与 `translated`（6 份，带完整中文正文）。**结构性检查只施加于带正文的档案**。

## 9. 遗留与可选项

| 项 | 说明 |
|---|---|
| **头像的明暗主题真机核对** | **已完成**，见 5.10；深色下奶油色描边起了贴纸分隔作用 |
| 卡片宽度随滚动条变 8px | **5.9 已治并经用户实测确认**，不是遗留项 |
| P5 tag | 只差 `git tag`。四条工具路径现在全部真跑过（见第 3 节），可以打了 |
| ~~`summon_expert` 首次真跑~~ | **已完成**，见第 3 节与 5.12 |
| 客户端包 **625 KB** | 加头像前是 250 KB，头像贡献了 375 KB（其中生成文件 362 KB）。主要构成：内联 zod + 279 张 data URI。要瘦身有两条路：把生成文件改成"存原始 SVG、加载时编码一次"（省约 140 KB），或把编辑器预校验换成手写检查（省 zod） |
| 生成文件占 362 KB 而素材只有 222 KB | `encodeURIComponent` 会把 `<` `>` `"` `=` 全转义，膨胀 63%。想省这 140 KB 就得改用最小转义（只处理 `#` 和 `%`），但那要赌浏览器对裸 `<`/`>` 的容忍度 —— 目前选择"无聊但一定对" |
| 参考实现里没有移植的能力 | 「猜宿主设置按钮」的 DOM 启发式。宿主 `ui-settings-general` 本地不可读、无法验证，故不做；菜单空态改为提示「请先在设置页启用」 |
| 与 `@michengai/dsh-agency-agents` 的关系 | 用户已自行卸载。若两者同时安装会**工具名冲突**（都注册 `list_experts` / `summon_expert` / `summon_experts`） |
| **刻意没做的事**（防止后来者"顺手修好"） | ① `Config.enabled` **不**按 `customExperts` 那样放宽成 `z.any()`——它会出现在设置表单里，改 schema 会改变表单渲染；运行期已做规范化，够了。② 头像检查器**不**因扩展名不是小写 `.svg` 判失败（现有素材全小写，那是新规则不是缺陷）。③ `@deepseek-ai/dsh-system-prompt` 保留在依赖里——**它现在是在用的**（§5.19 的系统提示段落），5.18 时它曾因"全文件没人用"被删过一次 |
| 用户目前无法表达"模型可以用哪些专家" | `enabled` 只治理浏览器侧（`@` 菜单），4 个工具看**全部 279 位**（D17）。这是刻意的默认，用户 2026-09-14 明确表示**暂不需要**这个控制权；真要做，正确做法是**加一个独立字段**（`agentEnabled`），而不是让 `enabled` 在非空时兼职过滤工具——那会把"我不想在菜单里看到它"变成"禁止模型用它" |

## 10. 续工起点

- 改 Host 逻辑 → `src/index.ts`（工具与 catalog）、`src/remote.ts`（Remote 方法）、`src/roster-settings.ts`（enabled 与自定义专家）
- 改浏览器端 → `src/client/index.ts`（页面与触发器）、`src/client/locales.ts`（词条，zh 为 key 集真源，en 由 `satisfies` 编译期强制一致）
- 改浏览器端之后 → 必须跑 `pnpm exec vitest run src/client/index.test.ts`：这 **34 条**在 jsdom 里用**真实的 279 份资产**渲染真实组件，是唯一能在没有浏览器的情况下抓到「一次写入锁死整页」「连点被吞」「抛错变白屏」「滚动条一来自适应布局就跑偏」「data URI 里漏了个 `#` 转义」「引用 source 名与注册名不一致」「宿主重载后 revision 归零导致永久写不动」的地方。**新写这类断言时先在旧代码上跑一遍确认它会失败**，否则它只是装饰 —— 例如 §5.18 里那条"出厂名册 0 冲突"的断言在旧夹具下恒真，必须如实标注为空洞断言
- 改资产或术语 → 动 `assets/`、`sync/glossary.json` 后必须跑 `pnpm sync:stamp && pnpm check`
- **改头像素材** → 动 `assets/avatar/` 之后跑 `pnpm avatars:inline`（`typecheck` / `test` / `verify` 都会自动先跑，裸 `vitest` 由 `globalSetup` 兜住）。**`src/client/avatars.ts` 是生成文件，且不进 git —— 不要手改，也不要试图提交它**。素材树本身在本机、不在仓库里，**换台机器就没有头像**，这是刻意的
- 改契约 → 先改 `docs/PLAN.md` 再改代码
- **UI 布局铁律**（在同一个 8px 上踩了三轮才收敛）：**先问「什么东西的尺寸在变」，而不是「哪个元素在动」**。设置面板的滚动区（`.options`，`overflow-y:auto`）在名册非空时有滚动条、清空时没有，**内容框宽度差 8px**（`--dsh-scrollbar-width: 8px`，实占不是覆盖式）。只要这个宽度会变，**任何占满宽度的东西都会抖** —— 卡片、简介折行、右锚定的按钮，全都会。所以现在的做法是**锁死宽度**，而不是逐个元素去躲：
  ```css
  .aall-section{ min-height:calc(100% + 1px) }        /* 滚动条永远画出来 */
  :has(> .aall-section){ scrollbar-gutter:stable }    /* 容器自己预留 gutter */
  ```
  宽度定住之后，页头按钮才可以安全地右对齐（`flex:1 1 260px` + `margin-left:auto`）。这四条都由 `src/client/index.test.ts` 直接对样式表文本断言钉住。**注意 `:has()` 那条是整个样式表里唯一不以 `.aall-` 开头的规则**，是有意为之，注释里写了理由 —— 不要再加别的宿主耦合规则。

英文侧**永远不要手改**：`assets/en/` 是上游快照，`pnpm check` 会逐字节核对，改了必然硬失败。
