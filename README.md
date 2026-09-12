# dsh-agency-agents-ll

DeepSeek Harness 的**中英双语** Agency 专家名册插件 —— 只切换**提示词**语言，专家名固定中文。

Bilingual (English/Chinese) Agency expert roster for DeepSeek Harness. The **persona prompt** switches language; the expert **name** stays Chinese.

> 状态：**P0 骨架**。工程与双端构建已就位，名册数据与功能按 `docs/PLAN.md` 的阶段推进。

## 它和 `@michengai/dsh-agency-agents` 的区别

| | 原插件 | 本插件 |
|---|---|---|
| 提示词语言 | 绑死 DSH 界面语言 | 独立三态开关（`auto`/`zh`/`en`），默认英文 |
| 中文名真源 | 硬编码名称表 + 中文文件，**145 处互相矛盾** | **只有中文文件**，单一真源 |
| 中文缺译文时 | 塞通用模板顶数（**45 份**） | 明确标记为缺失，可查询、可告警 |
| 内容来源 | 上游快照 + 手工同步 | `sync/` 管线，manifest 记录上游 commit 与逐文件校验值 |
| 英文正文 | 被二次改写（21 份） | 逐字节对齐上游，不改写，保证可重复同步 |

## 内容规模

名册取两个 MIT 上游的**并集**：328 个专家。

| 集合 | 数量 |
|---|---|
| 两边都有（现成双语对） | 228 |
| 只有英文上游（需补中文） | 51 |
| 只有中文上游（需补英文） | 49 |

## 上游与许可

- 英文：https://github.com/msitarzewski/agency-agents （MIT）
- 中文：https://github.com/jnMetaCode/agency-agents-zh （MIT，含 `company`/`hr`/`legal`/`supply-chain` 分区）

本项目源码、构建脚本与文档采用 Apache-2.0；`NOTICE` 保留两个上游的署名。

## 开发

`node` / `npm` 不在 PATH 时，构建链通过 DSH Desktop 自带的 runtime shim（Node v24.18.1 + pnpm 11.8.0）：

```powershell
pnpm install
pnpm build        # typecheck + tsdown（Host 半边 ESM，客户端半边 ModuleLoader CJS）
pnpm verify       # 发布门禁
pnpm sync         # 从两个上游同步资产（P1）
```

本地安装到 DSH profile：

```powershell
dsh plugin --profile desktop add ./dsh-agency-agents-ll
dsh --profile desktop --dump-config    # 应看到 dsh-agency-agents-ll 这一层
```

## 目录

```
sync/            上游同步与机械质量门禁（P1）
assets/en|zh/    两个上游的资产快照，各自带 MIT LICENSE
src/contract.ts  两端共享的常量与纯函数
src/index.ts     Host：名册、工具、设置命名空间
src/client/      浏览器：设置页与输入框触发器（P4）
docs/PLAN.md     实施规格（契约）
```

完整规格、质量门禁与阶段验收见 **[`docs/PLAN.md`](docs/PLAN.md)**。
