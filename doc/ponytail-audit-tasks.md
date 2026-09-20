# Ponytail 深度三级 Review 与 0 置信审计任务清单 (Agent B 页面)

> 审计依据：`https://github.com/DietrichGebert/ponytail.git` 规范
> 审计目标：`src/agent-b-v2/AgentBDirect.vue` (5385+ 行)
> 审计标准：0 置信假设（不预设已有代码是正确的，以代码实际运行与单职责解耦为真相源）

---

## 总体健康评估

| 评估维度 | 评级 | 核心诊断 |
| :--- | :--- | :--- |
| **结构健康度** | 🔴 不及格 | `AgentBDirect.vue` 超 5500 行，承担了状态管理、网络调用、Markdown 解析、音频合成、时间线计算与数十个 Modal 渲染，是典型的上帝组件 |
| **运行时健壮性** | 🟢 良好 | 具备完备的竞态保护 (`checkRunId`)、超时控制 (`AbortController`) 与纯前端 ASR 本地兜底 |
| **技术债追踪** | 🟡 待完善 | 存在部分重复解析、内联样式与多处冗余的 `parseBoard` / JSON 反序列化 |

---

## 3 级深度发现与修复任务清单

### Level 1: 架构级 (Architecture & God Component Deconstruction)
- [ ] **TASK-01 (上帝组件拆分)**: 将 `AgentBDirect.vue` 拆分为独立子模块：
  - `WorkbenchHeader.vue` (状态标签、操作按钮组、API 配置入口)
  - `FiveFieldTable.vue` (五字段脚本执行表及行内交互)
  - `CheckReviewCard.vue` (Check Agent 状态与审查进度条)
  - `DeliverableModals.vue` (修缮比对、产物生成、API 规范抽屉等弹窗集合)
- [ ] **TASK-02 (Prompt 与规范文件收敛)**: 检查 `src/agent-b-v2/prompt.js` 与 `src/check-agent/prompt.js` 中的重叠规则，消除重复描述，规范唯一真相源。
- [ ] **TASK-03 (JSON 反序列化收敛)**: 收拢 `parseBoard`、`safeJsonParse` 与 `normalizeBoardsField`，统一收敛到 `src/utils/boardSerializer.js`，避免不同子系统解析标准出现偏差。
- [ ] **TASK-04 (状态外置管理)**: 提取 TTS 行内音频合成与缓存管理 (`rowAudioCache`) 至独立的 Composition API `useRowAudio.js`。

### Level 2: 函数级 (Function Purity & Performance)
- [ ] **TASK-05 (避免渲染高频重复解析)**: `getRowEstimatedSeconds`、`renderBoardContent` 与 `parseBoard` 在模板渲染和 Table 遍历中高频同步执行，应引入轻量 Memoize 或在更新时预计算。
- [ ] **TASK-06 (输入防抖与响应式节流)**: 口播输入框 `@change` 虽已实现实时重算时间线，但在高频连续输入或粘贴大段文本时应提供 150ms 防抖，降低重算开销。
- [ ] **TASK-07 (错误边界与局部隔离)**: 将每个弹窗（`refineModal`、`deliverableModal`、`apiSpecDrawer`）隔离为动态加载或局部组件，避免根组件重绘联动。
- [ ] **TASK-08 (音频播放单例锁强化)**: 统一全局音频播放器句柄，确保点击不同步骤播放试听时，前一个音频立即释放并不留后台内存泄漏。

### Level 3: 行级与视觉健壮性 (Line-level & Accessibility)
- [ ] **TASK-09 (无障碍属性与 aria-label)**: 为自定义胶囊按钮、折叠触发器和图标按钮补齐 `aria-label` 与键盘可访问性 (`role="button"` + `tabindex="0"`)。
- [ ] **TASK-10 (CSS 变量一致性)**: 消除组件内残余的硬编码十六进制颜色，统一对齐 `var(--surface)`、`var(--brand)`、`var(--ink-deep)` 等全局可爱手账色系。
- [ ] **TASK-11 (清理孤立未使用的响应式变量)**: 扫描清理 `AgentBDirect.vue` 中遗留的历史调试变量。
- [ ] **TASK-12 (表格横向滚动的视觉柔化)**: 在表格容器边缘添加微弱的内阴影与渐变遮罩提示，优化小屏幕或宽表格下的横向溢出体验。

---

## 当前已落地改进 (2026-09-20)
- ✅ **Check 审查状态进度条**: 已在 `AgentBDirect.vue` 的五字段执行表上方集成 `<div class="check-progress-card">`，支持 `check_agent` 与 `math_asr` 双模式的百分比进度动画与阶段流转。
- ✅ **胶囊 Clip 视觉重构**: 在 `src/style.css` 与 `AgentBDirect.vue` 中将音频控制、操作胶囊与标签升级为 `border-radius: 9999px`，具备微弱浮动阴影与悬停弹动效果。
- ✅ **构建校验**: `npm run build` 成功通过，画布能力与坐标锚定完全冻结受保护。
