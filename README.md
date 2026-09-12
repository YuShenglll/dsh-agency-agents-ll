# dsh-agency-agents-ll

DeepSeek Harness 的**中英双语** The Agency 专家名册插件 —— 只切换**提示词**语言，专家名固定中文。

Bilingual (English/Chinese) Agency expert roster for DeepSeek Harness. The **persona prompt** switches language; the expert **name** stays Chinese.

> 状态：**P0 骨架完成**。工程、双端构建与发布门禁已就位；名册数据与功能按 [`docs/PLAN.md`](docs/PLAN.md) 的阶段推进。

## 它做什么

- 收录 **279 位专家 / 18 个分区**：安全、工程、设计、市场、销售、金融、法务之外的产品与项目角色，以及游戏开发、GIS、空间计算、学术、医疗健康等专业方向。
- 每位专家有两份**提示词**：英文原文与中文译文。
- 召唤专家时按当前设置决定用哪一份，**默认英文**，需要时切中文。
- 专家**名称固定中文**，不随提示词语言变化 —— 名册读起来始终是中文的。

## 提示词语言

三态开关，在 DSH 设置的插件配置里：

| 取值 | 行为 |
|---|---|
| `auto` | 跟随 DSH 界面语言 |
| `zh` | 始终用中文提示词 |
| `en` | 始终用英文提示词（默认） |

切换到哪种语言只影响送进子代理的 persona 正文，不影响名册里显示的名字、简介与分区。

## 内容来源

| 产物 | 来源 | 许可 |
|---|---|---|
| 英文 persona | [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents)，逐字节同步不改写 | MIT |
| 中文 persona | 本项目翻译与精校 | 上游 MIT 的演绎作品，随附上游 MIT 原文 |
| 源码、构建脚本、文档 | 本项目 | Apache-2.0 |

中文侧按源文件哈希跟踪新鲜度：英文文件一变，对应中文即被标记为 `stale` 并由发布门禁拦下，不会静默错位。详见 [`docs/PLAN.md`](docs/PLAN.md) 第 3 节。

## 开发

`node` / `npm` 可能不在 PATH；构建链可通过 DSH Desktop 自带的 runtime shim（Node v24.18.1 + pnpm 11.8.0）运行：

```powershell
pnpm install
pnpm build        # typecheck + tsdown：Host 半边 ESM，客户端半边 ModuleLoader CJS
pnpm verify       # 发布门禁
pnpm sync         # 从上游同步英文资产并刷新 manifest（P1）
```

本地安装到 DSH profile：

```powershell
dsh plugin --profile desktop add ./dsh-agency-agents-ll
dsh --profile desktop --dump-config    # 应看到 dsh-agency-agents-ll 这一层
```

## 目录

```
sync/            上游同步、机械质量门禁与术语表（P1）
assets/en/       英文上游快照，逐字节同步，不手改
assets/zh/       中文译文，按源哈希跟踪新鲜度
src/contract.ts  两端共享的常量与纯函数
src/index.ts     Host：名册、工具、设置命名空间
src/client/      浏览器：设置页与输入框触发器（P4）
docs/PLAN.md     实施规格（契约）
```

完整的决策表、质量门禁与阶段验收见 **[`docs/PLAN.md`](docs/PLAN.md)**。
