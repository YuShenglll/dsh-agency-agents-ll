# 上游更新：三种用法

上游（[`msitarzewski/agency-agents`](https://github.com/msitarzewski/agency-agents)）新增或改动专家时，
你有三种方式知道、并跟上来。**日常只需要第 2 种 —— 它自己会来找你。**

| 想干什么 | 敲什么 | 花多久 | 会不会改东西 |
|---|---|---|---|
| 现在就想知道有没有更新 | `pnpm upstream:check` | 约 2 秒 | 不会 |
| 什么都不做，等通知 | 无需操作 | — | 不会 |
| 真的把更新跟上来 | `pnpm sync:upstream` | 约 10 秒 | **会** |

> 本文只讲「更新」这件事。设计契约见 [`PLAN.md`](PLAN.md)，开发与排障见 [`STATUS.md`](STATUS.md)，
> 头像素材规格见 [`AVATARS.md`](AVATARS.md)，完整更新流程（含新分区要改哪些代码）见 [`UPDATE.md`](UPDATE.md)。

---

## 方式一：随手问一句

**什么时候用**：你正好想起来「上游最近有没有动静」。

```powershell
pnpm upstream:check
```

**没有更新时**，你会看到：

```
agency-agents-ll - 上游有没有更新

上游:   https://github.com/msitarzewski/agency-agents
基线:   ad9264e309bd  (sync/manifest.json，上次同步的记录)
远端:   ad9264e309bd  没动

上游无更新：远端默认分支仍是 ad9264e309bd，名册 279 位与基线一致。
```

**有更新时**（下面是示例，用模拟上游跑出来的）：

```
上游:   https://github.com/msitarzewski/agency-agents
基线:   ad9264e309bd  (sync/manifest.json，上次同步的记录)
远端:   9f3c1d2a4e10  <- 动过了

上游名册有更新：
  新增专家 (2)：签下来就能用英文人设，中文档案要另写
    + engineering/engineering-observability-engineer
    + quantum/quantum-algorithm-designer
  英文有改动 (1)：原有中文档案会因此变成「过期」
    ~ engineering/engineering-backend-architect
  上游已删除 (1)：
    - healthcare/healthcare-innovation-strategist
  新增分区 (1)：quantum（要改三处代码）

下一步：pnpm sync:upstream —— 拉下来、列出还缺哪些中文档案，再跑门禁。
```

**看到「名册有更新」就敲** `pnpm sync:upstream`（方式三）。没有就别管。

### 两个要理解的点

**它只比名册，不比提交。** 上游改了 README、脚本或集成配置时，它会明确说「有新提交，但**名册没变**」，
不会让你白跑一趟。名册 = 18 个分区目录下带 frontmatter 的 `.md` 专家文件。

**为什么只要 2 秒**：先做一次 `git ls-remote` 拿远端默认分支的提交号。和 `sync/manifest.json` 里记的
基线一致就直接结束，**连缓存目录都不建**。不一致才浅克隆一份到 `sync/.cache/` 里逐位比对。

### 退出码

| 码 | 含义 | 该做什么 |
|---|---|---|
| `0` | 名册没变 | 什么都不用做 |
| `1` | 名册变了 | 跑 `pnpm sync:upstream` |
| `2` | **这次没查成**（网络或 git 故障） | 查网络，重试 |

> **`2` 绝不等于「没有更新」。** 这是刻意分开的：监视坏掉的那天如果返回 `0`，你会以为天下太平。
> 看到 `2` 就当作「不知道」。

### 给脚本用的两个开关

```powershell
pnpm upstream:check -- --json       # 机器可读的完整报告
pnpm upstream:check -- --markdown   # 可直接当 GitHub issue 正文
```

---

## 方式二：什么都不做，等通知（推荐）

**这是日常唯一需要的方式。**

仓库里有一个 GitHub Actions 工作流 `.github/workflows/upstream-watch.yml`，**每天北京时间约 09:23**
在 GitHub 自己的机器上跑一次方式一 —— **不需要你的电脑开着**。

| 它查到 | 它会做什么 |
|---|---|
| 名册变了 | 开一个标题为 `[上游] 名册有更新` 的 issue，正文就是差量清单。**GitHub 会邮件通知你** |
| 名册没变 | 把遗留的那个 issue 自动关掉 |
| 查不动（网络/git 故障） | 让工作流**失败** —— GitHub 会告诉你「监视本身坏了」，而不是假装没事 |

你收到 issue 之后，按里面的「下一步」敲一次 `pnpm sync:upstream` 就行；同步跟上后，那个 issue 会
在第二天自动关闭。

**它不会重复打扰你**：issue 已经开着、而且内容没变时，它什么都不做，不会每天给你发一次通知。
只有差量**真的变了**才会更新正文。

### 手动跑一次

Actions 页面 → 左侧「上游名册监视」→ 右侧 `Run workflow`。或者：

```powershell
gh workflow run upstream-watch.yml --repo YuShenglll/dsh-agency-agents-ll
```

### 不想要了

删掉 `.github/workflows/upstream-watch.yml` 并推送，或在 Actions 页面里点 `Disable workflow`。

### 两个平台注意事项

- GitHub 会在仓库 **60 天没有任何活动**后暂停定时工作流（暂停前会发通知给你）。恢复：手动跑一次即可。
- `cron` 用 UTC，且整点排队最久，所以定在 `23 1 * * *`。

---

## 方式三：真的把更新跟上来

**什么时候用**：方式一报 `1`，或方式二的 issue 来了。

```powershell
pnpm sync:upstream
```

它依次做三件事，末尾给一张汇总表：

| 步骤 | 做什么 |
|---|---|
| 1/3 | `git fetch` + 快进上游 checkout，把新增/改动的英文人设拷进 `assets/en/`，刷新 `sync/manifest.json` |
| 2/3 | 列出**还需要人工补写**什么（中文档案、头像、要改的代码） |
| 3/3 | 跑 13 项机械门禁 |

**没有更新时**，结尾是这样：

```
汇总
  同步      ok
  待办      0 项
  门禁      ok
```

**有更新时**，第 2 步会把每一项要点名的文件打出来，例如：

```
中文档案缺失 (2)
  -> 每位写一个 assets/zh/<分区>/<slug>.md，至少含 name / description / emoji / intro
  engineering/engineering-observability-engineer   Observability Engineer  🔭
      Builds tracing, metrics and logging pipelines so a distributed system can explain its own behaviour
      写 assets/zh/engineering/engineering-observability-engineer.md

待办: 4 项（这些需要人写，不是脚本报错）
可选: 2 位专家还没有头像，emoji 兜底，不影响任何门禁。
```

### 退出码

| 码 | 含义 |
|---|---|
| `0` | 同步好、没有待办、门禁全过 |
| `1` | 同步失败，或**有待办要人写**，或门禁失败 —— 汇总表会说明是哪种 |

「有待办」**不是脚本报错**，是它在告诉你该写东西了。

### 之后要人做什么

只有两件事需要人（或者让 AI）动手：**写中文档案**、**画头像**。其余全机械：

```powershell
pnpm authoring        # 随时重看待办清单（不拉取、不同步，只报告）
#   ... 按清单写 assets/zh/<分区>/<slug>.md ...
pnpm sync:stamp       # 给新写/改过的中文档案盖 sourceSha256
#   ... 可选：把 <slug>.svg 放进 assets/avatar/ ...
pnpm avatars          # 重生成 docs/AVATARS.md 的清单
pnpm avatars:inline   # 重生成 src/client/avatars.ts（改了素材必跑）
pnpm build            # typecheck + tsdown
pnpm test             # 单元测试
pnpm verify           # 发布门禁
pnpm check            # 13 项机械门禁，应为 roster=N / aligned=N / suspect=0 / missing=0
```

新分区还要改三处代码（`src/names.ts`、`sync/glossary.json`、`scripts/verify.mjs`），
`pnpm authoring` 会点名提醒。详见 [`UPDATE.md`](UPDATE.md) 第 3 节。

---

## 常见情况速查

| 现象 | 含义 | 怎么办 |
|---|---|---|
| `upstream:check` 退出码 2 | 没查成，**不代表没更新** | 查网络能否访问 GitHub；重试 |
| 工作流在 Actions 页面变红 | 监视本身坏了 | 看 run 日志；多半是网络或上游改地址 |
| issue 一直开着 | 差量还在，还没同步 | 跑 `pnpm sync:upstream`，第二天自动关 |
| 「有新提交，但名册没变」 | 上游只改了文档/脚本 | 可以不管；想跟上就跑 `pnpm sync:upstream` |
| `pnpm check` 报 `english-byte-identity` | `assets/en` 与上游字节不一致 | **别用 `git checkout` 还原**，重跑 `pnpm sync`（见下） |
| 中文档案被判「过期」 | 英文改了，`sourceSha256` 对不上 | 更新译文后跑 `pnpm sync:stamp` |

> **别用 `git checkout` 还原 `assets/en`。** `core.autocrlf = true`（Git for Windows 默认值）会把
> checkout 出来的文件写成 CRLF，而 `git status` 看不出来、`english-byte-identity` 会红。
> 要还原就重跑 `pnpm sync` —— 它按上游的字节覆盖。根因见 [`STATUS.md`](STATUS.md) 5.16。

---

## 三者的关系

```
方式二（每天自动）──┐
                    ├─→ 名册变了 ─→ 方式三 pnpm sync:upstream ─→ 写中文档案 ─→ 门禁
方式一（随手问）────┘                    （拉取 + 点名 + 门禁）
```

三者用的是**同一份判定代码**（`sync/upstream-check.mjs`）：方式一是手动跑它，方式二是每天在
GitHub 上跑它。所以你在本地看到的结论，和收到通知时的结论一定一致。
