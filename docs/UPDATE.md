# 上游更新流程

上游 [`msitarzewski/agency-agents`](https://github.com/msitarzewski/agency-agents) 新增专家时，
本项目要怎么跟上。**一条命令**：

> 不想主动问？看最后一节「[让上游来找你](#7-让上游来找你而不是你去问)」。

```powershell
pnpm sync:upstream
```

它依次做三件事，并在最后给出一张汇总表：

| 步骤 | 做什么 |
|---|---|
| 1/3 | `git fetch` + 快进上游 checkout，然后把新增/改动的英文人设拷进 `assets/en/`，刷新 `sync/manifest.json` |
| 2/3 | 列出**还需要人工补写**什么（中文档案、头像、要改的代码） |
| 3/3 | 跑 12 项机械门禁 |

退出码非 0 的含义有三种，汇总表会分别说明：同步失败 / **有待办要人写** / 门禁失败。
待办非空**不是脚本报错**，是它在告诉你该写东西了。

---

## 1. 为什么需要这条命令

`pnpm sync` 有两条容易踩的坑，`pnpm sync:upstream` 就是为它们存在的。

**坑一：`pnpm sync` 从不 pull。** 它只读取它找到的那个 checkout（`.cache/agency-agents` 或
`G:\dsh\agency-agents`），拷完就报成功。checkout 是旧的，同步出来的就是旧内容，而且**看不出任何异常**。

**坑二：新增专家不是门禁失败。** PLAN 第 3 节的设计里，没有中文档案的专家会**降级为英文人设**并计入
`missing`，而不是判失败（`sync/checks.mjs` 的 `HARD_FAILURE_CHECKS` 里没有 `missing`）。
所以上游加了三个专家、这边一个字没写，`pnpm check` 照样 12 项全绿、退出 0。

两条叠在一起，就是「上游更新了但我不知道」。所以更新必须走一条会联网、会点名的路径。

## 2. 六类待办

`pnpm authoring`（`sync/authoring.mjs`）把差异分成六类。**前六类计入待办，头像单独列且不计入**——
emoji 是文档承诺的兜底，素材允许分批交（见 `docs/AVATARS.md` 第 2 节）。

| 类别 | 含义 | 怎么处理 |
|---|---|---|
| `enOutOfSync` | `assets/en` 与 checkout 不一致（有人手动 pull 了却没 sync，或改过资产） | 先跑 `pnpm sync`，这份报告才有意义 |
| `divisionDrift` | 上游分区集合变了 | 见第 3 节：**要改三处代码** |
| `missingZh` | 上游有这位专家，本地没有中文档案 | 写 `assets/zh/<分区>/<slug>.md`，至少含 `name` / `description` / `emoji` / `intro` |
| `staleZh` | 中文档案的 `sourceSha256` 与当前英文不符 | 更新译文，再跑 `pnpm sync:stamp` 重新盖戳 |
| `unstamped` | 中文档案没有 `sourceSha256` | 纯机械：跑一次 `pnpm sync:stamp` |
| `removedUpstream` | 上游删掉了，本地两个树还在 | 删掉列出的文件，再跑 `pnpm sync` 让 manifest 丢掉记录 |
| `missingAvatar`（可选） | 没有 `assets/avatar/<slug>.svg` | 不给也行，卡片显示 emoji；补了要跑 `pnpm avatars:inline` |

`staleZh` 的后果分两档：**带译文正文**的档案会让 `translation-freshness` 硬失败（旧中文人设配新英文
指令会误导被召唤的专家）；**只有简介**的只是 WARN。

报告同时写到 `sync/authoring.json`（已 gitignore），字段和上表一一对应，供脚本读取。

## 3. 上游新增**分区**时

分区不只是内容，它还登记在三处代码里，必须一起改：

| 文件 | 改什么 |
|---|---|
| `src/names.ts` | `ZH_DIVISION` 和 `EN_DIVISION` 各加一条 |
| `sync/glossary.json` | 加一条 `division:<分区目录名>` |
| `scripts/verify.mjs` | `check('分区数量为 18', DIVISIONS.length === 18)` 里的数字 |

漏掉任何一处，`pnpm verify` 或 `pnpm build` 会红。`pnpm authoring` 的 `divisionDrift` 会点名这件事。

## 4. 完整流程

上游动了之后，从拉到验：

```powershell
pnpm sync:upstream                 # 1 拉取 + 同步 + 待办 + 门禁
#   ... 按待办写 assets/zh/<分区>/<slug>.md ...
pnpm sync:stamp                    # 2 给新写/改过的中文档案盖 sourceSha256
#   ... 可选：把 <slug>.svg 放进 assets/avatar/ ...
pnpm avatars                       # 3 重生成 docs/AVATARS.md 的清单
pnpm avatars:inline                # 4 重生成 src/client/avatars.ts（改了素材必跑）
pnpm build                         # 5 typecheck + tsdown
pnpm test                          # 6 单元测试
pnpm verify                        # 7 发布门禁
pnpm check                         # 8 12 项机械门禁，应为 roster=N / aligned=N / suspect=0 / missing=0
```

第 2、3、4、5、6、7、8 步都是机械的。**只有「写中文档案」和「画头像」需要人（或模型）动手**，
这也是 `pnpm authoring` 只报这两类的待办、并把英文的 `name` / `emoji` / `description` 一起打出来的原因。

## 5. 已知限制

**离线的 `pnpm sync` 无法知道上游动没动。** 它只能对比**上次 fetch 时**留下的
`origin/main` 引用：如果 checkout 落后于这个引用，它会打一条 WARNING；如果这个引用本身也是旧的，
它无从判断，也就不会告警——判断「远端有没有新提交」必须联网。

所以：**想知道上游有没有新专家，就跑 `pnpm sync:upstream`**（它会 fetch）。
`pnpm sync` 保持离线是刻意的——同一个命令在没有网络的机器上仍然产出同样的字节。

**不要用 `git checkout` 去还原 `assets/en` 里的文件。** `core.autocrlf = true`（Git for Windows 的默认值）会把 checkout 出来的文件写成 CRLF，而 `git status` 看不出来、`english-byte-identity` 会红。要还原就重跑 `pnpm sync` —— 它按上游的字节覆盖。根因与修法见 [`STATUS.md`](STATUS.md) 5.16。

## 6. 这套流程是怎么验证的

在一个临时目录里搭了一套带 bare 远端的模拟上游（`robocopy` 出真实上游工作树 → `git init` →
bare server → 两个 clone），然后逐个触发：

| 模拟动作 | 期望 | 实测 |
|---|---|---|
| 上游改了 `engineering-backend-architect` 并提交，但没 fetch | 只能说「无待办」 | 符合（这就是第 5 节的限制） |
| 手动快进 checkout、不跑 sync | `enOutOfSync` 点名该专家 | 命中 |
| `pnpm sync:upstream` | fetch + 快进，`roster: 279 -> 281` 并逐个点名 | 命中 |
| 上游在 `engineering/` 加一位专家 | `missingZh` 带 name / emoji / description / 目标路径 | 命中 |
| 上游新增 `quantum` 分区 | `divisionDrift` 提示三处登记 | 命中 |
| 上游改了已有专家的人设 | `staleZh` 点名；门禁 `translation-freshness` WARN（intro-only 档案） | 命中 |
| 手动抹掉某档案的 `sourceSha256` | `unstamped` 点名，建议 `pnpm sync:stamp` | 命中 |
| 上游删掉一位专家 | `removedUpstream` 点名要删的两个文件；门禁 `english-byte-identity` + `manifest-coverage` 硬失败、`suspect` 堆里出现该专家 | 命中 |
| 新专家还没配头像 | 列在可选区，不计入待办 | 命中 |

验证完成后仓库已还原到 279 基线（`assets/en`、`sync/manifest.json` 由 git 恢复）。

## 7. 让上游来找你，而不是你去问

第 1–6 节讲的都是**拉**模型：你不跑，就不会知道。下面两层解决「我怎么知道有更新」。

### 随手查：`pnpm upstream:check`

只做一件事——问上游「名册动了吗」，**不写盘**（除 `sync/.cache` 里的临时探测副本）。

先 `git ls-remote` 取远端默认分支的提交：与 `sync/manifest.json` 里记的基线一致就直接结束（实测 **2.1 秒**，连缓存目录都不建）。不一致才浅克隆一份到 `sync/.cache/upstream-probe-<仓库哈希>/`，逐位比对名册，报出新增 / 改动 / 删除的专家与分区变化。

它只比对**名册**，不比对文档：上游改了 README 或脚本，它会说「有新提交，但名册没变」，不会让你白跑一趟。

| 退出码 | 含义 |
|---|---|
| `0` | 名册没变（远端可能动了，但没动到专家） |
| `1` | 名册变了 → 跑 `pnpm sync:upstream` |
| `2` | **这次没查成**（网络或 git 故障） |

**`2` 不等于「没有更新」。** 这点很重要——否则监视坏掉的那天，你会以为天下太平。

`--json` 给脚本读，`--markdown` 输出可直接当 issue 正文。

### 自动查：`.github/workflows/upstream-watch.yml`

GitHub 每天早上（北京时间约 09:23）在 GitHub 自己的机器上跑一次 `upstream:check`，**不需要你的电脑开着**：

| 结果 | 动作 |
|---|---|
| 名册变了 | 开一个 `[上游] 名册有更新` 的 issue，正文就是差量清单；GitHub 会邮件通知你。已存在则只在**内容真的变了**时更新正文，不重复打扰 |
| 名册没变 | 关掉遗留的那个 issue |
| 查不动 | 让工作流**失败** —— GitHub 会告诉你「监视本身坏了」，而不是静默 |

两个平台注意事项：

- GitHub 会在仓库 **60 天没有任何活动**后暂停 schedule 工作流（暂停前会通知你）。恢复：Actions 页面 → 上游名册监视 → Run workflow。
- `cron` 用 UTC，且整点排队最久，所以选了 01:23。
