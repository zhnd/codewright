# Codewright 准确率重设计 — 证据支撑的改进路线图

> 基于 6 路文献/工业调研(2023–2026)综合。目标:**业界最强 bug-fix agent,准确率优先,面向真实仓库(含前端)。**
> 本文由调研主导提案,标注每条的**来源**与**杠杆强度**,并明确哪些是**之前没纳入**的新方向。
> 配套细化文档:[`localization-mechanism-gate-design.md`](./localization-mechanism-gate-design.md)(定位+机制闸门)。

---

## 0. 结论先行(按"性价比"排序的杠杆)

| # | 杠杆 | 证据强度 | Codewright 现状 |
|---|---|---|---|
| L1 | **补丁可应用性**:别让模型手写 diff,沙箱改文件 → `git diff` 出规范补丁 | 强(apply 失败占人工干预 ~60%;格式可让同模型摆动 10×) | ❌ 现在是模型手写 diff(astropy apply 失败正是此) |
| L2 | **采样 + 选择**(best-of-N + 强选择器) | 最强且最可操作(pass@N 是天花板,选择是瓶颈;oracle gap +26–30pp) | ⚠️ 有 best-of-N + 执行驱动选择,但选择器弱(纯 pass/fail) |
| L3 | **模型质量 / 多样性来自不同模型** | 强(GPT-4o→Claude +12pp;Devlo 3 模型 70.2%;DEI:跨模型多样性 > 同模型重采样) | ⚠️ 单模型;且现在跑 deepseek-flash(天花板) |
| L4 | **oracle 有效性的第二根轴**(change-coverage + 机制一致性 + test-reviewer) | 强(F→P 测试覆盖改动行 93% vs 非 F→P 60%;生成的复现测试仅 31% 是有效 oracle) | ❌ 只有 F→P(`oracleVerified`),无第二轴 |
| L5 | **前端/UI 运行时接地**(浏览器优先定位 + 视觉 oracle) | 中(无公开 UI-repair benchmark,但工具全部 production-grade) | ❌ 完全没有(iframe 失败的正解域) |
| L6 | **abstention(放弃门)**:题太烂不接 / 没把握不开 PR | 强(Google ICSE'26:接前放弃 +13pp,提交门 +15pp,合计 +39pp) | ❌ 现在"来者不拒" |
| L7 | **学习闭环**(Reflexion 重试 + 跨任务记忆 + 每仓缓存) | 中(ReasoningBank +4.6pp SWE-bench;失败轨迹价值 > 成功) | ⚠️ 有 trace 持久化,但没回灌 |
| L8 | **定位上下文质量 > 数量**(repo-map + 代码图工具,~6–10 文件) | 中强(RepoGraph +32.8%;行级上下文常**降低**准确率) | ⚠️ 有 repoNavigation 雏形,无 repo-map/代码图 |

> **架构共识**:没有"更多 agent"的红利。SOTA 形态 = **一个好 agent(或几个异构生成器)→ N 候选 → 执行/测试过滤 → 投票/verifier 选择**,即"agentic 生成 + pipeline 验证"的混合——**正是 Codewright 现在的骨架**。负面结论:专门的"修回归 agent"没用、thinking-mode 没用、30-agent 编排输给单 agent+规模(Augment / Aide / CodeStory 实证)。

---

## 1. 准确率杠杆详解(分领域 + 落到 Codewright)

### L1 · 补丁可应用性 —— **先修,这是活着的 bug**

**证据**:apply 失败 ≈ 人工干预的 60%(Morph);edit 格式能让同一模型从 6.7%→68.3%(10×);**模型手写 unified diff 的失败类**=漏上下文行/漏 `+`/吃掉缩进/**编造 hunk 头与行号**——与我们 astropy 的"编造 git index 行"一模一样(Aider unified-diffs)。`applicability` 与 resolved 率**统计正相关**(Diff-XYZ/FEA-Bench)。

**改法(Codewright)**:
1. implement agent **不再输出 diff**,改用 **SEARCH/REPLACE 编辑块**(`old_str`/`new_str`,无行号);
2. **让沙箱当编辑器**:agent 改工作树 → Codewright 跑 **`git diff` 生成规范补丁**(git 永远产出可应用的 diff)。这正好贴 Codewright 的 Docker-sandbox + git-host 架构;
3. 编辑步加**分层模糊匹配**(exact→去空白→相对缩进,Aider 关掉模糊 →9× 错误);非唯一匹配则要求 agent 补上下文;
4. 每次编辑后**校验是否落地**,失败**响亮报错**让 agent 在回路内重试。
- 落点:`packages/solver/.../implement-resolution`、`packages/sandbox`(git diff 导出)、`extract-patch`(改为读 git diff 而非 CRITIC 的手写 diff)。
- 来源:Aider unified-diffs / search-replace;Diff-XYZ(2510.12487);Inside-the-Scaffold(2604.03515);Sumit Gouthaman / Morph。

### L2 · 采样 + 选择 —— **最大可操作杠杆,Codewright 脊梁的升级**

**证据**:pass@N 是任何选择法的天花板,且随 N **对数线性**增长;oracle pass@1→pass@N 差距常 **+26–30pp**,好选择器能收回 40–60%。Codewright 现在的选择器是"执行驱动 pass/fail",**区分度不足**(同样通过的补丁无法排序,Best@K 早早 plateau)。

**改法(按性价比)**:
1. **选择级联**(Nemotron-Cascade):回归通过数 → 复现测试通过数 → **多数投票 → 最小补丁长度**。替换单一分数选择。
2. **补丁聚类做共识**:用 tree-sitter **AST 等价**(Trae)或**测试行为等价**(xTestCluster)归并候选,最大簇的代表更可信——比纯字符串投票更有区分度。Agentless 用 `|patches| × |tests|²` 给簇打分。
3. **混合 verifier**(R2E-Gym,+7–8pp):LLM-judge/RM 先缩到 top-n → **执行做最终裁决**。**critic 应喂入选择,而不只是最后的 HITL yes/no。**
4. **温度阶梯采样**:少量 0.2(求显然解)+ 多数 0.7–0.9(求多样),混合温度比单一温度 +7.3pt。
- 落点:`resolve-defect/transformer.ts`(`selectByExecution` 升级为级联+聚类)、`implement.ts`(采样策略)、可加一个 verifier activity。
- 来源:Scaling TTS(2604.16529)、Nemotron-Cascade(2512.13607)、R2E-Gym(2504.07164)、Trae(2507.23370)、xTestCluster、温度采样(2510.02611)。

### L3 · 模型质量 / 跨模型多样性

**证据**:模型是最干净的强杠杆(同脚手架 +12pp);**多样性来自不同模型/不同定位,而非同模型 N 次种子**(DEI 2408.07060:跨系统多样性 > 系统内;Devlo 用 Claude+o3+Gemini 取 70.2%)。

**改法**:① best-of-N 跨**不同模型/不同定位/不同 prompt** 取样(哪怕 2 个模型);② 保持 `AGENT_MODEL` 可换(已具备);③ **真实基线必须用 Claude**,deepseek-flash 是天花板(本会话已实证)。

### L4 · oracle 有效性的第二根轴 —— **直接关系到 iframe 那类"绿色假信号"**

**证据**:`fail-to-pass` 只是**一半信号**。LLM 写的 oracle 倾向捕捉"实现行为"而非"预期行为",buggy 代码上更糟(2410.21136);生成的复现测试**仅 31% 是有效 oracle**(Agentless);测试驱动的"精修"反而把 14/22 推向 overfit(2511.16858)——**靠对模型藏测试解决不了,必须加正交检查**。

**改法(便宜→强)**:
1. **change-coverage(ΔC)**:复现测试必须执行到补丁改动行(TDD-Bench;F→P 测试覆盖改动行 93% vs 60%)。
   > ⚠️ **诚实**:ΔC **抓不到本次 iframe**(定位/oracle/补丁三者自洽地一起错,oracle 会覆盖改动行)。它挡的是"oracle 没碰补丁"那类。
2. **机制一致性静态检查(亚秒级,能抓 iframe)**:把 oracle 引用的符号/选择器(`video`/`iframe`/DOM/API)与**工单文本 + 补丁触及的符号**做交集;零重叠 = 高概率机制错配。**这一条专治本次失败,且几乎免费。**
3. **诱饵/负控补丁**:跑一个无关 no-op 补丁,**可信 oracle 必须仍为红**;若变绿则 oracle 是假的(几乎免费,候选本就在跑)。
4. **test-reviewer(借 SpecRover)**:能**否决测试本身**,而不只是补丁。
5. **toxic-test 守卫(SWT-bench)**:仅当"≥1 个 F→P 且没有任何在候选修复态下失败的测试"才采纳测试集。
- 落点:`reproduce-defect`(机制锚定 + 引用真实 focal symbol)、`filter-candidate`/`establish-baseline`(ΔC、coverage-delta、decoy)、新增静态机制核验(便宜,可在 eval 自动放行时兜底)。
- 来源:SWT-bench(2406.12952)、TDD-Bench(2412.02883)、Otter++(2502.05368/2508.06365)、oracle 有效性(2410.21136)、overfitting(2511.16858)。

### L5 · 前端 / UI 运行时接地 —— **全新能力,iframe 失败的正解**

**证据**:**没有公开的 UI-repair benchmark**(最接近 SWE-bench Multimodal,最强系统仅 12.2% resolved)——蓝海;但工具全部 production-grade。SWE-bench M 实证:Python 式定位在 JS 上崩(Agentless F1 0.142),**图片是必需的**(去掉图片 13%→8.7%)。

**改法(Codewright 已能在沙箱跑 dev server + Playwright)**:
1. **浏览器优先定位(永不 grep 优先)**:起 dev server → Playwright 抓**实时 DOM 的真实标签集** + a11y 快照。**一眼看出 iframe vs video,且权威性高于按名 grep。** 这一步结构性消除本次失败。
2. **build 期注入源码溯源**:dev 构建注入 `data-source="file:line"` / `data-component`(Sentry 同款 babel 插件)→ "功能→组件"**塌缩成一次属性读取**;免疫 React 内部变动。
   > React 19 移除了 `_debugSource`(PR #28265)→ 需版本探测,回退 `__source` / `data-*` / bippy。
3. **UI 三通道验证 oracle**:① agent 写 Playwright 交互复现脚本(主,先验"修前红")② `toMatchAriaSnapshot`(结构)③ `toHaveScreenshot` 像素/感知 diff + **VLM 成对 before/after 判定**(VLM 用来**确认**不是**检测**:裸检测 39%,给参照图成对判定 ~100% 精度;有 ~5% 位置偏置 → 交换顺序跑两次取一致)。
- 来源:SWE-bench M(2410.03859)、OpenHands-Versa(2506.03011,**在浏览器内渲染验证前端改动**)、GUIRepair Code2Image(2506.16136)、Playwright a11y/视觉、Set-of-Marks(2310.11441)、Sentry babel-plugin-component-annotate、bippy。

### L6 · Abstention —— **准确率优先时最便宜的精度杠杆(全新)**

**证据**:Google "Abstain and Validate"(ICSE'26):**接单前放弃**(预测成功率,跳过没把握/描述不清的)+13pp;**提交门**(产出置信,低则不开 PR)+15pp;**合计 +39pp**。多数 agent"对每个 issue 都作答"本身就是可靠性 bug(BouncerBench)。

**改法**:① 流水线前加**bug-abstention 门**(题太烂/太模糊直接跳,省算力);② PR 前加**提交置信门**(低于阈值不开 PR,转人工)。**对你"开真实 PR"的场景:一个错 PR 的代价远高于一次跳过。**
- 来源:Abstain-and-Validate(2510.03217)、BouncerBench(2506.17812)。

### L7 · 学习闭环 —— **把 Codewright 的 trace 资产变成持续变强(全新)**

**证据**:**失败轨迹比成功更有学习价值,而多数系统把它丢了**——Codewright 已持久化失败阶段事件,正是别人当废料的高价值数据。但**检索精度压倒一切**:naive 记忆**会降低**准确率。

**改法(按先后)**:
1. **重试时 Reflexion(先上)**:失败后从"测试+reviewer 信号"蒸馏一条结构化反思,注入**重试**(Codewright 已有别人没有的 evaluator 信号);贴 Temporal retry。
2. **ReasoningBank 式跨任务记忆**:`{title, description, content}`,从**成功与失败**两边蒸馏,行动前检索;用 SWE-Exp 的三级 schema(理解/定位/补丁)。
3. **每仓 onboarding 缓存**:tree-sitter/PageRank repo-map + 累积的"约定/坑"简报,mtime 失效——Codewright 反复打同一批仓库,ROI 高。
4. **投资检索精度,不是体量**(带门控,A/B 量化)。
- 来源:Reflexion(2303.11366)、ReasoningBank(Google)、SWE-Exp(2507.23361)/ExpeRepair(2506.10484)、AWM(2409.07429)、Aider repo-map。

### L8 · 定位上下文(质量 > 数量)

**证据**:**更多上下文会降低修复准确率**——文件级广语义(~6–10 个相关文件)+ 行级极简(行级展开"常因噪声放大而降准");LLM 语义选文件比结构启发式**又准又省 token**;位置偏置(靠前的代码推理更好);agentic grep/图搜索(67–82% Acc@1)> 纯 embedding(~53%)。

**改法**:① Aider 式 **repo-map**(tree-sitter + personalized PageRank,只给签名,token 预算,偏向工单提到的符号);② **grep/ripgrep + 代码图当 agent 工具**(RepoGraph 式 `search_graph`,每仓缓存);③ 预算给质量:~6–10 文件 + 紧凑行级片段,最重要文件放前。
- 来源:Aider repomap、RepoGraph(2410.14684)、FL-Context(2604.05481)、LocAgent(2503.09089)、SWE-Debate(2507.23348)。

### 持久化 / 可观测(配套,贴 Temporal 栈)

- **`continue-as-new`** 显式用于长修复循环(避免 event-history 撑爆);**沙箱阶段边界快照**(失败补丁回滚**文件系统**,不只是 workflow 状态)——连 OpenHands/Aider 都没闭合这个;HITL 作**durable signal**;**OTel GenAI 语义约定 + Baggage**(任务/仓库 id 放 root span 经 Baggage 传播,否则 Langfuse 等按 span 聚合时无法过滤);**自动失败归因不可靠(~50%)**,记忆写入走**已验证结果**(reviewer+测试),模型猜的归因仅作提示。
- 验证:**OpenAI 的 Codex 就跑在 Temporal 上(生产、百万级)**——Codewright 架构被外部背书。
- 来源:Temporal-for-agents、OpenHands SDK(2511.03690)、OTel GenAI、Who&When(2505.00212)。

---

## 2. 哪些是"之前没提、这轮新增"的

1. **`git diff` 派生补丁 + SEARCH/REPLACE**(L1)——治 apply 失败。
2. **选择级联 + 补丁聚类 + 混合 verifier**(L2)——选择器从 pass/fail 升级。
3. **跨模型多样性**(L3)——多样性来源换成不同模型/定位。
4. **机制一致性静态检查 / 诱饵补丁 / test-reviewer / toxic-test 守卫**(L4)——抓"自洽错 oracle",**其中机制一致性检查专治 iframe**。
5. **整套前端运行时接地**(L5)——浏览器优先定位 + 源码溯源 + 视觉 oracle。
6. **abstention 双门**(L6)——准确率优先最便宜的精度提升。
7. **学习闭环**(L7)——Reflexion/记忆/每仓缓存,把 trace 变资产。
8. **沙箱阶段快照 + continue-as-new + OTel/Baggage**(持久化)。

---

## 3. 优先级路线图(我的建议)

**P0 — 先修活着的 bug + 最便宜的精度(本周可落)**
- L1 补丁可应用性(git diff 派生)——**必做,否则正确补丁也落不了地**。
- L4-#2 机制一致性静态检查 + L4-#3 诱饵补丁——便宜,直接堵"自洽假绿"(含 iframe)。
- L6 提交置信门(低置信不开 PR)——一个错 PR 代价最高。

**P1 — 选择器与 oracle 的硬升级**
- L2 选择级联 + 补丁聚类(+ critic 喂入选择)。
- L4-#1 change-coverage(ΔC) + L4-#5 toxic-test 守卫 + L4-#4 test-reviewer。
- L3 跨模型 best-of-N(至少 Claude + 1)。

**P2 — 前端能力 + 定位质量**
- L5 浏览器优先定位 + 源码溯源 + UI 三通道验证(开"前端 bug"这条线)。
- L8 repo-map + 代码图工具 + 上下文质量预算。
- 定位+机制闸门(见配套文档)+ reject 可 `retarget` 重定位。

**P3 — 复利与稳态**
- L7 Reflexion 重试 → ReasoningBank 记忆 → 每仓缓存。
- 持久化:沙箱阶段快照、continue-as-new、OTel GenAI + Baggage、回归子集选择(TestPrune)。

---

## 4. 与现有资产/文档的关系

- Codewright 已有的 **Agentless 式 localize→reproduce→implement→validate、执行驱动选择、baseline-differential(`oracleVerified`=F→P,正是 SWT-bench 准则)、analyze 后 HITL 闸门、per-stage trace + Temporal** —— 调研一致认为**骨架方向正确**;本文是"在对的骨架上补杠杆"。
- 与 [`localization-mechanism-gate-design.md`](./localization-mechanism-gate-design.md) 互补:那份细化"定位+机制闸门/工单增强/排序候选/reject 重定位";本文给全景排序 + 选择/可应用性/前端/学习闭环。

---

## 5. 主要来源(去重)

SWE-agent 2405.15793 · Agentless 2407.01489 · AutoCodeRover 2404.05427 · SpecRover 2408.02232 · OpenHands/CodeAct 2407.16741 · SWE-Search/Moatless 2410.20285 · Trae 2507.23370 · DEI 2408.07060 · R2E-Gym 2504.07164 · Nemotron-Cascade 2512.13607 · Scaling-TTS 2604.16529 · 温度采样 2510.02611 · SWT-bench 2406.12952 · TDD-Bench 2412.02883 · Otter/e-Otter++ 2502.05368 / 2508.06365 · oracle 有效性 2410.21136 · overfitting 2511.16858 · TestPrune 2510.18270 · Abstain-and-Validate 2510.03217 · BouncerBench 2506.17812 · SWE-bench M 2410.03859 · OpenHands-Versa 2506.03011 · GUIRepair 2506.16136 · Set-of-Marks 2310.11441 · RepoGraph 2410.14684 · FL-Context 2604.05481 · LocAgent 2503.09089 · SWE-Debate 2507.23348 · Reflexion 2303.11366 · ReasoningBank(Google) · SWE-Exp 2507.23361 · AWM 2409.07429 · OpenHands SDK 2511.03690 · Who&When 2505.00212 · HULA 2411.12924 · 排行榜剖析 2506.17208 · Diff-XYZ 2510.12487 · Inside-the-Scaffold 2604.03515 · Aider repomap/unified-diffs · Sentry babel-plugin-component-annotate · bippy · OpenTelemetry GenAI semconv。

> 注:部分 2026 年 arXiv 编号来自检索摘要(少数 PDF 取不到),引用前应核对原文数字;承重结论(R2E-Gym 混合顺序、SWT-bench toxic-test 规则、Abstain-and-Validate 收益、测试精修导致 overfit、apply 失败占比)均来自已抓取或交叉确认的来源。
