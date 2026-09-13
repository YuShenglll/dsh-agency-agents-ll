# 卡片头像素材：规格与清单

名册共 **279** 个专家，覆盖 **18** 个分区。头像按**专家**提供，一个专家一张。

文件名的**主干必须逐字符等于**下表 `slug` 列，扩展名 `.svg`。除此之外不接受任何别名。

## 1. 规格

| 项 | 要求 |
|---|---|
| 格式 | **SVG**，纯文本，可优化过的导出 |
| 画布 | 任意**正方形** `viewBox`，推荐 `0 0 48 48` |
| 渲染尺寸 | **48 × 48 CSS px**，即画布尺寸本身 —— 素材按 **1:1** 绘制，不做重采样。窄屏（≤640px）降为 40px |
| 安全区 | 内容落在**内切圆**内（容器是 `border-radius:50%`），四周留约 8% 边距。画布 48 时内切圆半径 24，已有素材的实测外接半径是 16.5–20.1 |
| 背景 | **透明**。不要铺满画布的底色矩形 |
| 配色 | 由你定，但必须**在浅色和深色主题下都看得清**；避免大面积接近纯黑或纯白 |
| 单文件体积 | 目标 ≤ 2 KB，硬上限 5 KB |
| 总体积 | 目标 ≤ 600 KB（279 张合计） |

**允许的元素**：`<path>` `<g>` `<circle>` `<rect>` `<ellipse>` `<polygon>` `<line>` `<polyline>`，以及文件内自带的 `<defs>` 渐变。

**不允许**：`<image>`（内嵌位图）、`<text>`、`<foreignObject>`、`<script>`、`<style>`、`<mask>`、`<filter>`、`<pattern>`、任何外部引用。

**不要有 `id` 属性。** 279 张最终内联进**同一个客户端模块**，同名的 `id` 会互相覆盖。已有的 279 张都不含 `id`，这正是它们能直接拼在一起的原因。

**请去掉编辑器元数据**：Figma / Sketch / Inkscape 的 `<metadata>`、`id="Layer_1"`、`xmlns:inkscape` 之类。跑一遍 SVGO 最好。

## 2. 现状

**279 / 279 已交付并接入**（2026-09-13）。实测：总体积 217 KB，最大单文件 1434 B，平均 797 B，全部正方形 `viewBox`，零禁用元素，零 `id`。

下表 `emoji` 列是**兜底**：日后上游新增专家、还没配图时，卡片继续显示它的 emoji，不会出现空白。所以新增素材可以分批给，不必一次备齐。

## 3. 接入方式

素材放 `assets/avatar/`（`.svg` 平铺，不用按分区建子目录），然后 `pnpm avatars:inline` 重新生成 `src/client/avatars.ts`。**改了素材不重新生成，`pnpm verify` 会红。**

## 4. 清单

### 学术（`academic`）— 6 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `academic-anthropologist` | 文化人类学家 | Anthropologist | 🌍 |
| `academic-geographer` | 地理学家 | Geographer | 🗺️ |
| `academic-historian` | 历史学家 | Historian | 📚 |
| `academic-narratologist` | 叙事学家 | Narratologist | 📜 |
| `academic-psychologist` | 心理学家 | Psychologist | 🧠 |
| `academic-statistician` | 定量研究统计学家 | Statistician | 📊 |

### 设计（`design`）— 10 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `design-brand-guardian` | 品牌守护者 | Brand Guardian | 🎨 |
| `design-image-prompt-engineer` | 图像提示词工程师 | Image Prompt Engineer | 📷 |
| `design-inclusive-visuals-specialist` | 包容性视觉提示词工程师 | Inclusive Visuals Specialist | 🌈 |
| `design-persona-walkthrough` | 角色画像走查专家 | Persona Walkthrough Specialist | 🎭 |
| `design-ui-designer` | 界面设计师 | UI Designer | 🎨 |
| `design-ui-finish-gate-reviewer` | 界面交付终审评审员 | UI Finish-Gate Reviewer | 🧱 |
| `design-ux-architect` | 体验架构师 | UX Architect | 📐 |
| `design-ux-researcher` | 用户体验研究员 | UX Researcher | 🔬 |
| `design-visual-storyteller` | 视觉叙事设计师 | Visual Storyteller | 🎬 |
| `design-whimsy-injector` | 品牌趣味体验设计师 | Whimsy Injector | ✨ |

### 工程（`engineering`）— 64 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `engineering-ai-data-remediation-engineer` | 异常数据修复工程师 | AI Data Remediation Engineer | 🧬 |
| `engineering-ai-engineer` | 人工智能工程师 | AI Engineer | 🤖 |
| `engineering-api-platform-engineer` | 接口平台工程师 | API Platform Engineer | 🔌 |
| `engineering-ats-validator-architect` | 简历解析合规架构师 | ATS Validator Architect | 🎯 |
| `engineering-autonomous-optimization-architect` | 自主优化架构师 | Autonomous Optimization Architect | ⚡ |
| `engineering-backend-architect` | 后端架构师 | Backend Architect | 🏗️ |
| `engineering-china-network-engineer` | 国产网络设备工程师 | China Network Engineer | 🌏 |
| `engineering-cms-developer` | 内容管理系统开发工程师 | CMS Developer | 🧱 |
| `engineering-code-reviewer` | 代码评审员 | Code Reviewer | 👁️ |
| `engineering-codebase-onboarding-engineer` | 代码库上手引导工程师 | Codebase Onboarding Engineer | 🧭 |
| `engineering-data-engineer` | 数据工程师 | Data Engineer | 🔧 |
| `engineering-data-visualization-engineer` | 数据可视化工程师 | Data Visualization Engineer | 📈 |
| `engineering-database-optimizer` | 数据库优化工程师 | Database Optimizer | 🗄️ |
| `engineering-database-reliability-engineer` | 数据库可靠性工程师 | Database Reliability Engineer | 🛟 |
| `engineering-desktop-app-engineer` | 桌面应用工程师 | Desktop App Engineer | 💻 |
| `engineering-developer-tooling-engineer` | 开发者工具工程师 | Developer Tooling Engineer | 🛠️ |
| `engineering-devops-automator` | 运维自动化工程师 | DevOps Automator | ⚙️ |
| `engineering-drupal-performance` | 网站性能优化工程师 | Drupal Performance Engineer | ⚡ |
| `engineering-drupal-shopping-cart` | 电商购物车工程师 | Drupal Shopping Cart Engineer | 🛒 |
| `engineering-email-intelligence-engineer` | 邮件情报工程师 | Email Intelligence Engineer | 📧 |
| `engineering-embedded-firmware-engineer` | 嵌入式固件工程师 | Embedded Firmware Engineer | 🔩 |
| `engineering-feishu-integration-developer` | 飞书集成开发工程师 | Feishu Integration Developer | 🔗 |
| `engineering-filament-optimization-specialist` | 管理后台界面优化专家 | Filament Optimization Specialist | 🔧 |
| `engineering-finops-engineer` | 云成本优化工程师 | FinOps Engineer | 💰 |
| `engineering-frontend-developer` | 前端开发工程师 | Frontend Developer | 🖥️ |
| `engineering-gaussdb-expert` | 高斯数据库专家 | GaussDB Expert Engineer | 🗄️ |
| `engineering-git-workflow-master` | 版本控制工作流专家 | Git Workflow Master | 🌿 |
| `engineering-i18n-engineer` | 国际化工程师 | Internationalization Engineer | 🌍 |
| `engineering-identity-access-engineer` | 身份与访问工程师 | Identity & Access Engineer | 🔐 |
| `engineering-incident-response-commander` | 事故响应指挥官 | Incident Response Commander | 🚨 |
| `engineering-iot-fleet-engineer` | 物联网设备运维工程师 | IoT Fleet Engineer | 📡 |
| `engineering-it-service-manager` | 信息技术服务经理 | IT Service Manager | 🖧 |
| `engineering-knowledge-graph-engineer` | 知识图谱工程师 | Knowledge Graph Engineer | 🧠 |
| `engineering-llm-post-training-engineer` | 大模型后训练工程师 | LLM Post-Training Engineer | 🧪 |
| `engineering-minimal-change-engineer` | 最小改动工程师 | Minimal Change Engineer | 🪡 |
| `engineering-mobile-app-builder` | 移动应用开发工程师 | Mobile App Builder | 📲 |
| `engineering-mobile-release-engineer` | 移动端发布工程师 | Mobile Release Engineer | 🚀 |
| `engineering-multi-agent-systems-architect` | 多智能体系统架构师 | Multi-Agent Systems Architect | 🕸️ |
| `engineering-network-engineer` | 网络工程师 | Network Engineer | 🌐 |
| `engineering-orgscript-engineer` | 流程建模语言工程师 | OrgScript Engineer | 📜 |
| `engineering-payments-billing-engineer` | 支付与计费工程师 | Payments & Billing Engineer | 💳 |
| `engineering-pdf-engine-architect` | 文档引擎架构师 | PDF Engine Architect | 📑 |
| `engineering-platform-engineer` | 平台工程师 | Platform Engineer | 🛤️ |
| `engineering-privacy-engineer` | 隐私工程师 | Privacy Engineer | 🕵️ |
| `engineering-prompt-engineer` | 提示词工程师 | Prompt Engineer | 🧬 |
| `engineering-rag-pipeline-engineer` | 检索增强生成工程师 | RAG Pipeline Engineer | 🔍 |
| `engineering-rapid-prototyper` | 快速原型开发工程师 | Rapid Prototyper | ⚡ |
| `engineering-realtime-collaboration-engineer` | 实时协作工程师 | Realtime Collaboration Engineer | 🤝 |
| `engineering-rust-refactoring-specialist` | 系统级代码重构专家 | Rust Refactoring Specialist | 🦀 |
| `engineering-search-relevance-engineer` | 搜索相关性工程师 | Search Relevance Engineer | 🔎 |
| `engineering-section-508-specialist` | 无障碍合规工程师 | Section 508 Accessibility Specialist | ♿ |
| `engineering-senior-developer` | 高级全栈开发工程师 | Senior Developer | 💎 |
| `engineering-software-architect` | 软件架构师 | Software Architect | 🏛️ |
| `engineering-solidity-smart-contract-engineer` | 智能合约工程师 | Solidity Smart Contract Engineer | ⛓️ |
| `engineering-sre` | 站点可靠性工程师 | SRE (Site Reliability Engineer) | 🛡️ |
| `engineering-technical-writer` | 技术文档工程师 | Technical Writer | 📚 |
| `engineering-universal-document-compiler` | 通用文档编译器架构师 | Universal Document Compiler | 📑 |
| `engineering-uswds-developer` | 政务前端开发工程师 | USWDS Developer | 🏛️ |
| `engineering-video-streaming-engineer` | 视频流媒体工程师 | Video Streaming Engineer | 🎬 |
| `engineering-voice-ai-integration-engineer` | 语音转写集成工程师 | Voice AI Integration Engineer | 🎙️ |
| `engineering-webassembly-engineer` | 网页汇编工程师 | WebAssembly Engineer | 🧩 |
| `engineering-wechat-mini-program-developer` | 微信小程序开发工程师 | WeChat Mini Program Developer | 💬 |
| `engineering-wordpress-performance` | WordPress 性能工程师 | WordPress Performance Engineer | ⚡ |
| `engineering-wordpress-shopping-cart` | 电商购物车工程师 | WordPress Shopping Cart Engineer | 🛍️ |

### 金融（`finance`）— 5 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `finance-bookkeeper-controller` | 会计与内控主管 | Bookkeeper & Controller | 📒 |
| `finance-financial-analyst` | 财务分析师 | Financial Analyst | 📊 |
| `finance-fpa-analyst` | 财务规划与分析专家 | FP&A Analyst | 📈 |
| `finance-investment-researcher` | 投资研究员 | Investment Researcher | 🔍 |
| `finance-tax-strategist` | 税务策略师 | Tax Strategist | 🏛️ |

### 游戏开发（`game-development`）— 21 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `blender-addon-engineer` | 三维插件开发工程师 | Blender Add-on Engineer | 🧩 |
| `economy-designer` | 游戏经济设计师 | Economy Designer | 💰 |
| `game-audio-engineer` | 游戏音频工程师 | Game Audio Engineer | 🎵 |
| `game-designer` | 游戏设计师 | Game Designer | 🎮 |
| `godot-gameplay-scripter` | 节点式玩法脚本工程师 | Godot Gameplay Scripter | 🎯 |
| `godot-multiplayer-engineer` | 多人联机网络工程师 | Godot Multiplayer Engineer | 🌐 |
| `godot-shader-developer` | 游戏着色器开发工程师 | Godot Shader Developer | 💎 |
| `level-designer` | 关卡设计师 | Level Designer | 🗺️ |
| `narrative-designer` | 游戏叙事设计师 | Narrative Designer | 📖 |
| `roblox-avatar-creator` | 虚拟形象配饰设计师 | Roblox Avatar Creator | 👤 |
| `roblox-experience-designer` | 游戏体验与商业化设计师 | Roblox Experience Designer | 🎪 |
| `roblox-systems-scripter` | Roblox 系统脚本工程师 | Roblox Systems Scripter | 🔧 |
| `technical-artist` | 技术美术师 | Technical Artist | 🎨 |
| `unity-architect` | 游戏客户端架构师 | Unity Architect | 🏛️ |
| `unity-editor-tool-developer` | Unity 编辑器工具开发工程师 | Unity Editor Tool Developer | 🛠️ |
| `unity-multiplayer-engineer` | Unity 多人联机工程师 | Unity Multiplayer Engineer | 🔗 |
| `unity-shader-graph-artist` | 着色器开发工程师 | Unity Shader Graph Artist | ✨ |
| `unreal-multiplayer-architect` | 虚幻引擎联机架构师 | Unreal Multiplayer Architect | 🌐 |
| `unreal-systems-engineer` | 虚幻引擎系统工程师 | Unreal Systems Engineer | ⚙️ |
| `unreal-technical-artist` | 虚幻引擎技术美术 | Unreal Technical Artist | 🎨 |
| `unreal-world-builder` | 虚幻引擎开放世界架构师 | Unreal World Builder | 🌍 |

### 地理信息（`gis`）— 13 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `gis-3d-scene-developer` | 三维场景开发工程师 | 3D & Scene Developer | 🏔️ |
| `gis-analyst` | GIS 分析师 | GIS Analyst | 🖥️ |
| `gis-bim-specialist` | 建筑与地理信息集成专家 | BIM/GIS Specialist | 🏗️ |
| `gis-cartography-designer` | 地图制图设计师 | Cartography Designer | 🎨 |
| `gis-drone-reality-mapping` | 无人机实景三维测绘工程师 | Drone/Reality Mapping Specialist | 🛸 |
| `gis-geoai-ml-engineer` | 地理空间机器学习工程师 | GeoAI/ML Engineer | 🤖 |
| `gis-geoprocessing-specialist` | 地理处理自动化工程师 | Geoprocessing Specialist | ⚙️ |
| `gis-qa-engineer` | 空间数据质检工程师 | GIS QA Engineer | ✅ |
| `gis-solution-engineer` | 地理信息解决方案工程师 | Solution Engineer | 🔧 |
| `gis-spatial-data-engineer` | 空间数据工程师 | Spatial Data Engineer | 📦 |
| `gis-spatial-data-scientist` | 空间数据科学家 | Spatial Data Scientist | 📊 |
| `gis-technical-consultant` | 地理信息战略咨询顾问 | Technical Consultant | 🧠 |
| `gis-web-gis-developer` | Web GIS 开发工程师 | Web GIS Developer | 🌐 |

### 医疗健康（`healthcare`）— 3 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `healthcare-clinical-evidence-agent` | 临床证据顾问 | Clinical Evidence Agent | 🩺 |
| `healthcare-innovation-strategist` | 医疗创新叙事策略师 | Healthcare Innovation Strategist | 🧭 |
| `healthcare-sovereign-health-systems-agent` | 主权卫生体系合作专家 | Sovereign Health Systems Agent | 🌍 |

### 市场营销（`marketing`）— 36 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `marketing-aeo-foundations` | 答案引擎优化基础设施架构师 | AEO Foundations Architect | 🏗️ |
| `marketing-agentic-search-optimizer` | 智能体搜索优化师 | Agentic Search Optimizer | 🤖 |
| `marketing-ai-citation-strategist` | 生成式引擎优化策略师 | AI Citation Strategist | 🔮 |
| `marketing-app-store-optimizer` | 应用商店优化专家 | App Store Optimizer | 📱 |
| `marketing-baidu-seo-specialist` | 百度SEO优化专家 | Baidu SEO Specialist | 🇨🇳 |
| `marketing-bilibili-content-strategist` | 哔哩哔哩内容策略师 | Bilibili Content Strategist | 🎬 |
| `marketing-book-co-author` | 商业图书合著作者 | Book Co-Author | 📘 |
| `marketing-carousel-growth-engine` | 社媒轮播增长专家 | Carousel Growth Engine | 🎠 |
| `marketing-china-ecommerce-operator` | 中国电商运营专家 | China E-Commerce Operator | 🛒 |
| `marketing-china-market-localization-strategist` | 中国市场本地化策略师 | China Market Localization Strategist | 🇨🇳 |
| `marketing-content-creator` | 多平台内容创作专家 | Content Creator | ✍️ |
| `marketing-cross-border-ecommerce` | 跨境电商运营专家 | Cross-Border E-Commerce Specialist | 🌏 |
| `marketing-douyin-strategist` | 抖音营销策略专家 | Douyin Strategist | 🎵 |
| `marketing-email-strategist` | 邮件营销策略师 | Email Marketing Strategist | 📧 |
| `marketing-global-podcast-strategist` | 全球播客策略师 | Global Podcast Strategist | 🎙️ |
| `marketing-growth-hacker` | 增长黑客 | Growth Hacker | 🚀 |
| `marketing-instagram-curator` | 社媒视觉内容运营专家 | Instagram Curator | 📸 |
| `marketing-kuaishou-strategist` | 快手营销策略师 | Kuaishou Strategist | 🎥 |
| `marketing-linkedin-content-creator` | 领英内容创作者 | LinkedIn Content Creator | 💼 |
| `marketing-livestream-commerce-coach` | 直播电商教练 | Livestream Commerce Coach | 🎙️ |
| `marketing-multi-platform-publisher` | 多平台分发官 | Multi-Platform Publisher | 📡 |
| `marketing-podcast-strategist` | 中文播客策略师 | Podcast Strategist | 🎧 |
| `marketing-pr-communications-manager` | 公关与传播经理 | PR & Communications Manager | 📣 |
| `marketing-private-domain-operator` | 企业微信私域运营专家 | Private Domain Operator | 🔒 |
| `marketing-reddit-community-builder` | 海外社区口碑运营专家 | Reddit Community Builder | 💬 |
| `marketing-seo-specialist` | 搜索引擎优化专家 | SEO Specialist | 🔍 |
| `marketing-short-video-editing-coach` | 短视频剪辑教练 | Short-Video Editing Coach | 🎬 |
| `marketing-social-media-strategist` | 跨平台社媒策略专家 | Social Media Strategist | 📣 |
| `marketing-tiktok-strategist` | 短视频营销策略师 | TikTok Strategist | 🎵 |
| `marketing-twitter-engager` | 社媒实时互动专家 | Twitter Engager | 🐦 |
| `marketing-video-optimization-specialist` | 视频优化专家 | Video Optimization Specialist | 🎬 |
| `marketing-wechat-official-account` | 微信公众号运营专家 | WeChat Official Account Manager | 📱 |
| `marketing-weibo-strategist` | 微博营销策略专家 | Weibo Strategist | 🔥 |
| `marketing-x-twitter-intelligence-analyst` | 社媒情报分析师 | X/Twitter Intelligence Analyst | 🛰️ |
| `marketing-xiaohongshu-specialist` | 小红书营销专家 | Xiaohongshu Specialist | 🌸 |
| `marketing-zhihu-strategist` | 知乎营销策略师 | Zhihu Strategist | 🧠 |

### 付费媒体（`paid-media`）— 7 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `paid-media-auditor` | 付费媒体审计师 | Paid Media Auditor | 📋 |
| `paid-media-creative-strategist` | 广告创意策略师 | Ad Creative Strategist | ✍️ |
| `paid-media-paid-social-strategist` | 付费社媒广告策略师 | Paid Social Strategist | 📱 |
| `paid-media-ppc-strategist` | 付费搜索广告策略师 | PPC Campaign Strategist | 💰 |
| `paid-media-programmatic-buyer` | 程序化与展示广告采买师 | Programmatic & Display Buyer | 📺 |
| `paid-media-search-query-analyst` | 搜索词分析师 | Search Query Analyst | 🔍 |
| `paid-media-tracking-specialist` | 转化跟踪与衡量专家 | Tracking & Measurement Specialist | 📡 |

### 产品（`product`）— 5 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `product-behavioral-nudge-engine` | 行为助推设计师 | Behavioral Nudge Engine | 🧠 |
| `product-feedback-synthesizer` | 用户反馈分析师 | Feedback Synthesizer | 🔍 |
| `product-manager` | 产品经理 | Product Manager | 🧭 |
| `product-sprint-prioritizer` | 冲刺优先级专家 | Sprint Prioritizer | 🎯 |
| `product-trend-researcher` | 趋势研究员 | Trend Researcher | 🔭 |

### 项目管理（`project-management`）— 7 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `project-management-experiment-tracker` | 实验追踪专家 | Experiment Tracker | 🧪 |
| `project-management-jira-workflow-steward` | 交付可追溯性治理专家 | Jira Workflow Steward | 📋 |
| `project-management-meeting-notes-specialist` | 会议纪要专员 | Meeting Notes Specialist | 📋 |
| `project-management-project-shepherd` | 跨职能项目协调官 | Project Shepherd | 🐑 |
| `project-management-studio-operations` | 工作室运营经理 | Studio Operations | 🏭 |
| `project-management-studio-producer` | 工作室总制片人 | Studio Producer | 🎬 |
| `project-manager-senior` | 资深项目经理 | Senior Project Manager | 📝 |

### 研究（`research`）— 1 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `research-synthesist` | 研究综合专家 | Research Synthesist | 🔍 |

### 销售（`sales`）— 9 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `sales-account-strategist` | 客户拓展策略师 | Account Strategist | 🗺️ |
| `sales-coach` | 销售教练 | Sales Coach | 🏋️ |
| `sales-deal-strategist` | 赢单策略师 | Deal Strategist | ♟️ |
| `sales-discovery-coach` | 需求挖掘教练 | Discovery Coach | 🔍 |
| `sales-engineer` | 售前工程师 | Sales Engineer | 🛠️ |
| `sales-offer-lead-gen-strategist` | 成交主张与线索获取策略师 | Offer & Lead Gen Strategist | 🧲 |
| `sales-outbound-strategist` | 主动拓客策略师 | Outbound Strategist | 🎯 |
| `sales-pipeline-analyst` | 销售管线分析师 | Pipeline Analyst | 📊 |
| `sales-proposal-strategist` | 提案策略师 | Proposal Strategist | 🏹 |

### 安全（`security`）— 12 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `security-ai-generated-code-auditor` | AI 生成代码安全审计师 | AI-Generated Code Security Auditor | 🔎 |
| `security-appsec-engineer` | 应用安全工程师 | Application Security Engineer | 🔐 |
| `security-architect` | 安全架构师 | Security Architect | 🛡️ |
| `security-blockchain-security-auditor` | 区块链安全审计师 | Blockchain Security Auditor | 🛡️ |
| `security-cloud-security-architect` | 云安全架构师 | Cloud Security Architect | ☁️ |
| `security-compliance-auditor` | 安全合规审计师 | Compliance Auditor | 📋 |
| `security-incident-responder` | 应急响应专家 | Incident Responder | 🚨 |
| `security-penetration-tester` | 渗透测试工程师 | Penetration Tester | 🗡️ |
| `security-secrets-credential-engineer` | 密钥与凭据治理工程师 | Secrets & Credential Hygiene Engineer | 🔑 |
| `security-senior-secops` | 高级安全运营工程师 | Senior SecOps Engineer | 🛡️ |
| `security-threat-detection-engineer` | 威胁检测工程师 | Threat Detection Engineer | 🎯 |
| `security-threat-intelligence-analyst` | 威胁情报分析师 | Threat Intelligence Analyst | 🔍 |

### 空间计算（`spatial-computing`）— 6 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `macos-spatial-metal-engineer` | 苹果空间渲染工程师 | macOS Spatial/Metal Engineer | 🍎 |
| `terminal-integration-specialist` | 终端仿真集成专家 | Terminal Integration Specialist | 🖥️ |
| `visionos-spatial-engineer` | 空间计算应用工程师 | visionOS Spatial Engineer | 🥽 |
| `xr-cockpit-interaction-specialist` | 沉浸式座舱交互专家 | XR Cockpit Interaction Specialist | 🕹️ |
| `xr-immersive-developer` | 网页扩展现实开发工程师 | XR Immersive Developer | 🌐 |
| `xr-interface-architect` | 空间界面架构师 | XR Interface Architect | 🫧 |

### 专业（`specialized`）— 59 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `accounts-payable-agent` | 应付账款运营专家 | Accounts Payable Agent | 💸 |
| `agentic-identity-trust` | 智能体身份与信任架构师 | Agentic Identity & Trust Architect | 🔐 |
| `agents-orchestrator` | 智能体管线编排师 | Agents Orchestrator | 🎛️ |
| `automation-governance-architect` | 自动化治理架构师 | Automation Governance Architect | ⚙️ |
| `business-strategist` | 业务战略顾问 | Business Strategist | ♟️ |
| `change-management-consultant` | 变革管理顾问 | Change Management Consultant | 🔄 |
| `chief-financial-officer` | 首席财务官 | Chief Financial Officer | 💼 |
| `corporate-training-designer` | 企业培训设计师 | Corporate Training Designer | 📚 |
| `customer-service` | 客户服务专员 | Customer Service | 🎧 |
| `customer-success-manager` | 客户成功经理 | Customer Success Manager | 🌟 |
| `data-consolidation-agent` | 销售数据整合分析师 | Data Consolidation Agent | 🗄️ |
| `data-privacy-officer` | 数据隐私官 | Data Privacy Officer | 🔐 |
| `esg-sustainability-officer` | 可持续发展官 | ESG & Sustainability Officer | 🌱 |
| `government-digital-presales-consultant` | 政务数字化售前顾问 | Government Digital Presales Consultant | 🏛️ |
| `grant-writer` | 资助申请撰写专家 | Grant Writer | 📝 |
| `healthcare-aging-parent-care-companion` | 年迈父母照护协调助手 | Aging Parent Care Companion | 🧡 |
| `healthcare-customer-service` | 医疗客户服务专员 | Healthcare Customer Service | 🏥 |
| `healthcare-marketing-compliance` | 医疗健康营销合规专家 | Healthcare Marketing Compliance Specialist | ⚕️ |
| `hospitality-guest-services` | 酒店宾客服务专家 | Hospitality Guest Services | 🏨 |
| `hr-onboarding` | 员工入职专员 | HR Onboarding | 🤝 |
| `identity-graph-operator` | 身份图谱运营师 | Identity Graph Operator | 🕸️ |
| `language-translator` | 西英双语翻译 | Language Translator | 🌐 |
| `legal-billing-time-tracking` | 法律计费与工时管理专家 | Legal Billing & Time Tracking | ⏱️ |
| `legal-client-intake` | 法律客户接待专员 | Legal Client Intake | 📋 |
| `legal-document-review` | 法律文书审阅专家 | Legal Document Review | ⚖️ |
| `loan-officer-assistant` | 贷款专员助理 | Loan Officer Assistant | 🏦 |
| `lsp-index-engineer` | 语义索引工程师 | LSP/Index Engineer | 🔎 |
| `ma-integration-manager` | 并购整合经理 | M&A Integration Manager | 🤝 |
| `medical-billing-coding-specialist` | 医疗账单与编码专家 | Medical Billing & Coding Specialist | 🏥 |
| `operations-manager` | 运营经理 | Operations Manager | ⚙️ |
| `organizational-psychologist` | 组织心理学家 | Organizational Psychologist | 🧠 |
| `personal-growth-mentor` | 个人成长导师 | Personal Growth Mentor | 🌱 |
| `real-estate-buyer-seller` | 房地产买卖经纪人 | Real Estate Buyer & Seller | 🏠 |
| `recruitment-specialist` | 招聘专家 | Recruitment Specialist | 🎯 |
| `report-distribution-agent` | 报表分发专员 | Report Distribution Agent | 📤 |
| `resume-tailor` | 简历定制师 | Resume Tailor | 🧾 |
| `retail-customer-returns` | 零售退货专员 | Retail Customer Returns | 🛒 |
| `sales-data-extraction-agent` | 销售数据抽取智能体 | Sales Data Extraction Agent | 📊 |
| `sales-outreach` | B2B 销售拓展专家 | Sales Outreach | 🎯 |
| `specialized-chief-of-staff` | 首席幕僚长 | Chief of Staff | 🧭 |
| `specialized-civil-engineer` | 土木结构工程师 | Civil Engineer | 🏗️ |
| `specialized-codebase-archaeologist` | 代码库考古学家 | Codebase Archaeologist | 🏺 |
| `specialized-cultural-intelligence-strategist` | 文化智能策略师 | Cultural Intelligence Strategist | 🌍 |
| `specialized-developer-advocate` | 开发者布道师 | Developer Advocate | 🗣️ |
| `specialized-document-generator` | 文档生成工程师 | Document Generator | 📄 |
| `specialized-fedramp-rmf-compliance` | 联邦云合规授权工程师 | FedRAMP & RMF Compliance Engineer | 🛡️ |
| `specialized-focus-music-architect` | 器乐专注音乐架构师 | Focus Music Architect | 🎧 |
| `specialized-french-consulting-market` | 法国咨询市场顾问 | French Consulting Market Navigator | 🇫🇷 |
| `specialized-korean-business-navigator` | 韩国商务文化顾问 | Korean Business Navigator | 🇰🇷 |
| `specialized-master-plan-architect` | 总体规划架构师 | Master Plan Architect | 🏛️ |
| `specialized-mcp-builder` | 智能体工具开发工程师 | MCP Builder | 🔌 |
| `specialized-model-qa` | 模型质量审计师 | Model QA Specialist | 🔬 |
| `specialized-pricing-analyst` | 定价分析师 | Pricing Analyst | 💰 |
| `specialized-salesforce-architect` | 客户关系管理平台架构师 | Salesforce Architect | ☁️ |
| `specialized-strategy-duel-agent` | 策略对弈师 | Strategy Duel Agent | ⚔️ |
| `specialized-workflow-architect` | 工作流架构师 | Workflow Architect | 🗺️ |
| `study-abroad-advisor` | 留学规划顾问 | Study Abroad Advisor | 🎓 |
| `supply-chain-strategist` | 供应链策略专家 | Supply Chain Strategist | 🔗 |
| `zk-steward` | 卡片盒知识管家 | ZK Steward | 🗃️ |

### 支持（`support`）— 6 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `support-analytics-reporter` | 商业智能分析师 | Analytics Reporter | 📊 |
| `support-executive-summary-generator` | 高管摘要顾问 | Executive Summary Generator | 📝 |
| `support-finance-tracker` | 财务管控专家 | Finance Tracker | 💰 |
| `support-infrastructure-maintainer` | 基础设施运维专家 | Infrastructure Maintainer | 🏢 |
| `support-legal-compliance-checker` | 法律合规审查专家 | Legal Compliance Checker | ⚖️ |
| `support-support-responder` | 客户支持专员 | Support Responder | 💬 |

### 测试（`testing`）— 9 个

| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |
|---|---|---|---|
| `testing-accessibility-auditor` | 无障碍审计专家 | Accessibility Auditor | ♿ |
| `testing-api-tester` | 接口测试工程师 | API Tester | 🔌 |
| `testing-evidence-collector` | 视觉证据核验专员 | Evidence Collector | 📸 |
| `testing-performance-benchmarker` | 性能基准测试专家 | Performance Benchmarker | ⏱️ |
| `testing-reality-checker` | 上线就绪度评审专家 | Reality Checker | 🧐 |
| `testing-test-automation-engineer` | 测试自动化工程师 | Test Automation Engineer | 🎭 |
| `testing-test-results-analyzer` | 测试结果分析师 | Test Results Analyzer | 📋 |
| `testing-tool-evaluator` | 工具选型评测专家 | Tool Evaluator | 🔧 |
| `testing-workflow-optimizer` | 工作流程优化专家 | Workflow Optimizer | ⚡ |
