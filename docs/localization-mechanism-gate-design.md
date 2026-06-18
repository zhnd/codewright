# 定位 + 机制接地闸门 — 设计方案

> 目标:在写代码之前,把"自信的错定位 / 测错机制的假绿 oracle"在**最便宜的点**拦下,
> 并让人(或廉价的自动核验)用对代码库的了解快速纠正、纠正回灌重定位。

## 0. 一句话

把现有 `ANALYSIS` 后的 HITL 闸门从"看一段 root cause"升级为"**批准/纠正一个带证据的定位+机制计划**",
并补上两道机械护栏(reproduce 命中真实机制、change-coverage),让验证脊梁不再被上游的定位错误架空。

---

## 1. 背景与证据

### 1.1 触发这次设计的真实失败(ai-video-collection)

- 工单:`【agent v1.2】【ugc】查看预览视频，可以同时播放多个视频，请增加限制只能播放一个`
- **意图理解是对的**(只播一个);**定位 + 机制错了**:
  - analyze 的 rootCause:`AgentVideoPreviewer (via LazyVideoNext/EventsPlayVideo)` 管理 `<video>` 播放,照搬音频的 `stopOtherAudios()` 互斥。
  - 真相:UGC 预览由 **`<iframe src=video_url>`** 渲染(`_blocks/agent/_extensions/tool-messages/generate-preview-video/components/PreviewVideoSelector.tsx`),播放在 iframe 内部。`<video>` 互斥补丁**完全无效**。
- triage 的 `searchHypotheses` 查询词全是 `视频/预览/video/player/play/currentVideo/ugc`——**没有一个 `iframe`**,也没有"这个功能怎么渲染"的假设。
- **错误无声传播**:reproduce 跟着错定位,对同一个错机制(`<video>`)写 oracle → `oracle:true`(假绿)。

### 1.2 这是两个"有名有姓、被量化过"的失败模式

**FM1 — 自信的错定位(localization 是瓶颈)**
- 成功轨迹命中正确文件 93.5% vs 失败 79.8%;失败特征 = "没核实就声称位置"(arXiv 2511.00197)。
- 行级定位会塌到 ~14–19%(SWE-Explore)。HULA 在真实企业仓库上文件定位召回仅 30%(vs SWE-bench 86%,arXiv 2411.12924)。

**FM2 — 自洽的错 oracle**
- LLM 倾向写出捕捉"现状(buggy)行为"的 oracle,在 buggy 代码上更严重(arXiv 2410.21136)= 我们 `oracle:true` 假绿的精确写照。
- patch overfitting:过弱测试 ≠ 修对。

### 1.3 核心洞察

> **定位是一切的上游。定位错 → reproduce 写出"自洽但测错机制"的 oracle → 绿色假信号。
> 执行驱动验证(oracle/regression)救不了上游的定位错误。**
> 所以新增的拦截必须发生在 **localization/机制** 这一层,而不是更下游的门。

---

## 2. 目标 / 非目标

**目标**
1. 在 reproduce/implement 这些贵步骤**之前**,暴露并可纠正"定位/机制错误"。
2. 人的纠正能作为**硬约束回灌**,触发重定位(而不是在下游打补丁)。
3. 用便宜的机械护栏覆盖相邻失败类(oracle 与补丁不一致、自信单样本)。
4. 改动**贴合现有流水线**,不推倒重来。

**非目标**
- 不引入多 agent 角色扮演;不对所有 bug 强上动态分析;不替换 Claude/SDK。

---

## 3. 在现有流水线中的位置

```
triage-intent ──> analyze(localize) ──> [HITL 闸门] ──> reproduce ──> establishBaseline
                       │ (P1: +机制+证据)   │ (P1: 批准/纠正)        │ (P2: 命中已批准机制)
                       └──────── 纠正回灌 ◀──┘                        ▼
                                                          implement(best-of-N) ──> FILTER ──> critic(HITL) ──> PR
                                                                                     │ (P3: change-coverage)
```

闸门**框架已存在**(`resolve-defect` 的 ANALYSIS HITL,reject 会重跑 analyze)。本方案是**充实其内容 + 串起纠正 + 加两道护栏**。

---

## 4. 详细设计

### 4.0 【P1·新】工单增强(localization 之前) — 源自 HULA 头号教训

HULA 实测:agent 表现"**严重依赖详细的输入描述**";企业 Jira 工单中位数仅 **75 token**(SWE-bench 295),
定位召回因此从 86% 崩到 30%(arXiv 2411.12924,Lesson 1)。

我们这次的工单 `【agent v1.2】【ugc】查看预览视频，可以同时播放多个视频...` 就是个 **one-liner**——
agent 没有任何锚点,只能拿 `video/play` 去关键词撞,直接撞错到 `<video>` 组件。

- 在 triage **之前/之中**加一个 **issue-enrichment** 步:把工单里的弱信号(`agent v1.2` / `ugc` / `预览视频`)
  映射到**真实功能入口**——路由 / feature 目录 / 相关组件 / 近期相关 PR / 报错栈 / 设计文档,作为上下文喂给定位。
- 产出附在 `DefectIntent` 上(如 `featureEntryPoints[]`、`relatedArtifacts[]`),让 triage 的查询从"症状词"升级为"功能锚点"。
- **直接对应本次根因**:一个一句话工单,enrichment 后应能把"ugc 预览"锚到 `generate-preview-video` 目录,而不是泛泛的 video 播放器。

### 4.1 【P1】analyze 产出:强制"机制 + 证据 + 结构化定位"

`DefectAnalysis`(`packages/domain/agent-outputs/…`)新增字段:

| 字段 | 含义 | 例子(本应得到的) |
|---|---|---|
| `renderMechanism` | 该功能**实际怎么渲染/运行** | `预览通过 <iframe src=video_url> 渲染,播放在 iframe 内部` |
| `mechanismEvidence` | 证明机制的 `file:line` 证据 | `PreviewVideoSelector.tsx:81 <iframe …>` |
| `candidateLocations[]` | **排序候选**(非单一猜测) + 各自机制/证据/置信 | `1. generate-preview-video/PreviewVideoSelector(iframe,0.6) 2. LazyVideoNext(video,0.3)` |
| `targetFiles[]` | 选中候选的目标文件 + **每文件改法** | `PreviewVideoSelector.tsx: 仅挂载/播放选中项,切换时卸载其他 iframe src` |
| `localizationConfidence` | 自评置信(校准用) | `0.6` |

> **排序候选(源自 HULA):真实仓库定位召回仅 ~30%,单一猜测必然常错。** 给 top-N 候选 + 置信,让人在闸门
> **秒选/秒纠**(而不是只能 reject 后重跑)。低置信(候选分散)时主动要求人审或更深接地。

- analyze 的 system prompt 增加硬要求:**在提方案前,先回答"这个功能实际怎么渲染/运行",并给出读到的证据行**;
  禁止仅凭关键词匹配下结论(借 SpecRover 的"逐单元 intent spec" + "read before you claim",arXiv 2408.02232 / 2511.00197)。
- triage 的 `searchHypotheses` 增加一条**机制类查询**(强制覆盖 `iframe/canvas/video/webview/portal` 等渲染载体),
  避免只生成症状词查询。

### 4.2 【P1】HITL 闸门:批准物 = 定位+机制,两条纠正路径

闸门 output 呈现(借 HULA + Copilot Workspace):
- root cause / `renderMechanism` + 证据 / `targetFiles` + 每文件改法 / 置信。

reviewer 可:
- **(a) approve**;
- **(b) reject + 自然语言纠正** → 重跑 analyze;
- **(c)(后续)直接编辑** 目标文件/机制描述。

> 复用现有 `reviewSignal`,把 `feedback` 结构化(允许带"正确机制 / 正确入口文件"提示)。

### 4.3 【P1】纠正回灌 → 重定位

- reject 时,把人的纠正(如"预览是 iframe,看 `generate-preview-video`")作为**硬约束**注入重跑:
  - 注入 triage 的 `keyTerms`/`searchHypotheses`(加入 `iframe`、指定 scope 目录);
  - 注入 analyze 的 user prompt 作为"已知约束:渲染机制 = iframe;入口 ≈ …"。
- 已半存在(reject 重跑 analyze),需补"结构化纠正透传"(借 Copilot Workspace 的"改上游→重生成下游")。

### 4.4 【P2】reproduce 必须命中"已批准的机制"

- reproduce prompt 接收 `renderMechanism` + `targetFiles`;oracle 必须**真正驱动该功能的真实组件/入口**,
  而不是手搓一个脱离功能的 `<video>` 替身。
- **诚实边界**:若定位本身错了,reproduce 会"自洽地继续错"——这一条挡的是**另一类**失败(oracle 与功能脱节);
  **本次 iframe 失败的真正拦截点是 4.1–4.3 的机制闸门(人/自动核验)**,不是这一条。

### 4.5 【P3】change-coverage 护栏(机械,补相邻类)

- 实现后,要求**复现测试真的执行到补丁改动的那些行**(借 SWT-bench 的 ΔC,arXiv 2406.12952)。
- 计算:在 sandbox 内用仓库语言的覆盖工具(JS:`vitest --coverage`/`c8`;Python:`coverage.py`)跑 oracle,
  取改动文件改动行的命中率。
- **能抓什么**:补丁改 A 文件、oracle 却没碰 A(oracle 与补丁不一致)。
- **抓不到什么(要诚实)**:本次 iframe 失败是"定位/oracle/补丁三者自洽地一起错"(都围着 `<video>`),
  oracle **会**覆盖补丁改动行 → change-coverage 通过。**所以它不替代机制闸门**,只是补一类正交失败。
- 接入 `TestVerdict`:**可计算时作门;不可计算/跑不动时归 null**(沿用 build/regression 的"跑不动→无信号"纪律)。

### 4.6 【P4,可选】定位 self-consistency / 代码图

- 对定位采样 N 次:目标文件/机制不一致 → 低置信 → 强制人审或更深接地(借 USC,arXiv 2402.13212;SWE-Debate 2507.23348)。
- 代码图导航(RepoGraph 2410.14684 / AutoCodeRover):按"功能→调用/引用链"导航,降低一开始就错的概率(Phase 5)。

### 4.7 【P2·新】CRITIC reject 能回到"重定位",而不只是"重实现" — 源自 HULA 头号 UX 抱怨

HULA 实践者最高频抱怨(14 次)是 **"workflow revisiting difficulty"**——无法在 plan↔code 之间来回。

- **Codewright 现状的真实缺口**:CRITIC reject → 回到 **IMPLEMENT 重做**,即在**同一个(可能错的)定位**上反复 best-of-N。
  如果到 CRITIC 才看出"定位错了/机制错了",**没有便宜的路退回 ANALYSIS 重定位**——只能在错地方空转
  (我们 astropy / video 的 best-of-N 空转正是此症)。
- **改法**:CRITIC 的 reject 决策增加一个**路由维度**:`retarget`(回 ANALYSIS 重定位)vs `reimplement`(回 IMPLEMENT 重写)。
  reviewer 说"定位错了"→ 带着纠正回灌到 §4.3 的重定位;说"定位对、实现烂"→ 才回 IMPLEMENT。
- 控制面据此选择回跳的 stage(workflow 已有 stage 编排,扩一个分支即可)。

---

## 5. 代码改动落点

| 改动 | 文件 |
|---|---|
| **issue-enrichment** 步 + `DefectIntent` 加 `featureEntryPoints[]`/`relatedArtifacts[]` | `packages/solver/src/agents/triage-defect-intent/*` + `packages/domain/src/agent-outputs/*intent*.ts` |
| `DefectAnalysis` 加 `renderMechanism`/`mechanismEvidence`/`candidateLocations[]`/`targetFiles`/`localizationConfidence` | `packages/domain/src/agent-outputs/analyze*.ts` |
| analyze 强制机制+证据 + 排序候选 | `packages/solver/src/agents/analyze-defect/prompts.ts` |
| triage 机制类查询 + 接收纠正约束 | `packages/solver/src/agents/triage-defect-intent/*` |
| HITL 闸门呈现新内容 + 结构化 feedback | `packages/workflow/src/workflows/resolve-defect/index.ts`(analyze 阶段)+ `transformer.ts`(闸门 output 构造) |
| 纠正回灌(reject→重跑带约束) | `resolve-defect/phases/analyze.ts` |
| reproduce 接收已批准机制 | `packages/solver/src/agents/reproduce-defect/prompts.ts` + `reproduce-defect.ts` activity |
| change-coverage | `packages/workflow/src/activities/filter-candidate.ts`(+ 可能 `establish-baseline.ts`) |
| verdict 加 `changeCoveragePassed` | `packages/domain/src/verdict.ts` + `resolve-defect/transformer.ts`(`deriveTestVerdict`) |
| CRITIC reject 路由 `retarget`(回 ANALYSIS)vs `reimplement`(回 IMPLEMENT) | `resolve-defect/phases/implement.ts` + `index.ts`(reviewGate decision + stage 回跳分支) |

---

## 6. 分期(按性价比)

- **P1(最高,便宜,直接治本次 bug)**:issue-enrichment(§4.0)+ analyze 强制 `renderMechanism`+证据+排序候选(§4.1)
  → HITL 闸门呈现(§4.2)→ 纠正回灌(§4.3)。人(懂代码库)就能在最便宜的点一眼拦住"iframe 当成 video"。
- **P2**:reproduce 命中已批准机制(§4.4)+ CRITIC reject 能 `retarget` 回重定位(§4.7,挡 best-of-N 在错定位上空转)。
- **P3**:change-coverage 门(§4.5,挡 oracle-补丁不一致;机械、可量化)。
- **P4**:定位 self-consistency / 代码图(§4.6,降低初始错误率,Phase 5 territory)。

---

## 7. 对 eval 的影响(重要)

- eval 的**自动放行会绕过这个闸门**——本次 bug 正是这样溜过去的。两条出路:
  1. 真实仓库的准确率实验**保留人审**(半自动);
  2. 加一个**廉价的自动"机制核验器"**替代人:用 analyze 给的 `targetFiles` + `renderMechanism`,
     在 sandbox 里 grep 验证(如声称 `<video>` 就检查目标文件是否真有 `<video>`/`iframe`),不一致则判低置信 → reject 重定位。
  - 推荐 1+2 并行:有人时人审,无人时自动核验兜底。

---

## 8. 风险 / 待定

- **change-coverage 对纯 UI bug**可能没有可执行 oracle(reproduce 走 steps-only)→ 仅在有可执行 oracle 时启用,否则 null。
- **覆盖工具的环境脆弱性**:同 build/regression 的教训,命令可能在大仓库跑不动 → 必须"跑不动→无信号",不可硬当失败。
- **self-consistency 成本**:N× 定位算力,先只在低置信时触发。
- **残余风险(诚实)**:一个"内部自洽的错定位"在机械层面几乎无法自动证伪——
  **最终兜底是把判断接地到"功能真实如何渲染/运行"(人,或对真实渲染产物的核验)**。这正是 P1 机制闸门存在的根本理由。

---

## 9. 来自 HULA(2411.12924)的漏斗洞察 — 配套优化

HULA 是唯一有规模化部署数据(2 个月、663 工单、2600 人)的同类系统,其漏斗暴露了**该优化什么**:

| 环节 | HULA | 启示 |
|---|---|---|
| plan 批准 | **82%** | 闸门本身不是瓶颈 |
| code 生成 | 87% | — |
| **→ 开 PR** | **25%**(95/376) | **漏斗在这里崩**:四分之三"已批准+已生成"的根本没成 PR |
| PR 合并 | 59% | 一旦成 PR 反而健康 |
| 端到端 | **8%** | — |
| 真实仓库定位召回 | **30%**(SWE-bench 86%) | 真实仓库定位极差,全靠人审兜 |

**对 Codewright 的取舍**:
- **认知纠偏**:有人审时瓶颈在"代码质量(code→PR)";**无人时(我们 eval 自动放行)瓶颈在定位**——本次正是后者。
  两条都要,别只磨闸门。
- **重定义成功 = "好到人能轻松收尾"**:HULA 只有 50% 觉得代码解决了任务,但 **83% 觉得代码易懂好改**。
  对"开真实 PR"的产品目标,**部分修复 + 人 5 分钟收尾**也是高价值;保留"人可在生成代码上分支手改再开 PR"的逃生口。
- **门别只给 pass/fail,要出"人读得懂的正确性证据"**(HULA Lesson 2:通过单测不应是评判功能的唯一目标)。
  与我们把 build 降级为 advisory 一致。
- **把整条漏斗做成指标**:plan 生成→批准→code→PR→merge 逐环测,**code→PR 转化率**当北极星;离线用定位召回当 plan 质量代理。
- **LLM 可换**:HULA 只验了 GPT-4 且明说更强模型更好 → 印证 deepseek-flash 是天花板,真实基线该上 Claude。
- **诚实边界**:HULA 因商业机密**未披露**检索方法 / prompt / 迭代上限 / 上下文管理 / 成本延迟——这些它给不了答案。

## 10. 参考(论文 / 产品)

**HITL 计划批准(工业)**
- Atlassian **HULA** — arXiv 2411.12924(ICSE 2025 SEIP;Jira 部署):批准物 = 目标文件 + 每文件改法;两条纠正路径。
- **GitHub Copilot Workspace**:spec→plan(改哪些文件+每文件步骤)→实现;改上游重生成下游。
- **Devin** Interactive Planning / **Cursor / Claude Code / Factory / Tabnine** plan mode:plan 带文件+代码引用,先批准后写码。

**定位(学术)**
- Agentless(arXiv 2407.01489)、RepoGraph(2410.14684)、AutoCodeRover(2404.05427)、RGFL(justify-before-rank)、SWE-Debate(2507.23348)。
- 失败模式:Understanding Code Agent Behaviour(2511.00197)、SWE-Explore(行级定位塌陷)。

**intent / spec(学术)**
- SpecRover(2408.02232)、AdverIntent-Agent(2505.13008)、ClarifyGPT(2310.10996)。

**oracle / 复现验证(学术)**
- SWT-Bench(2406.12952,fail-to-pass + ΔC change-coverage)、Otter/e-Otter++(2502.05368)、
  "Do LLMs generate test oracles that capture actual or expected behaviour"(2410.21136)、patch overfitting(UCL FSE-IVR 2024)。
- self-consistency:Universal/Soft SC(2402.13212)。

> 提示:Codewright 已具备 Agentless 式 localize→reproduce→implement→validate、执行驱动选择、
> **baseline-differential oracle(`oracleVerified` = fail-to-pass,正是 SWT-bench 准则)**、analyze 后 HITL 闸门——
> 本方案是在这些已有资产上"补机制接地 + 纠正回灌 + change-coverage",非重写。
