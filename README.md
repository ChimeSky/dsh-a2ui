# dsh-a2ui — Answer-first A2UI for DeepSeek Harness

> **让 AI 的数据型回答，更直观、更易理解。**
> 
> *Make data-heavy AI answers easier to understand with inline, on-demand A2UI visualizations.*

[![Version](https://img.shields.io/badge/version-0.3.1-blue.svg)](./CHANGELOG.md)
[![Protocol](https://img.shields.io/badge/A2UI-1.0-teal.svg)](https://google.github.io/a2ui/)
[![Tests](https://img.shields.io/badge/tests-171%20passed-brightgreen.svg)](./docs/TEST-REPORT.md)
[![React Tests](https://img.shields.io/badge/react%20tests-19%20passed-brightgreen.svg)](./docs/TEST-REPORT.md)
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

[English](./README.en.md) | [更新日志](./CHANGELOG.md) | [架构设计](./docs/ARCHITECTURE.md) | [测试报告](./docs/TEST-REPORT.md)

**dsh-a2ui** 是一个基于 Google A2UI 1.0 协议的 DeepSeek Harness (DSH) 插件，为普通 AI 对话提供**按需生成的可视化界面**。

当回答涉及**数据对比、统计趋势、数值关系或算法过程**时，Agent 可以直接在对话流中生成可排序表格、图表、指标卡和轻量交互组件；对于简单的问题，则依然保持极简的普通 Markdown 回答。

它的目标**不是**让 AI 创建一个持续运行的复杂仪表盘或应用工作台，而是**为每一次回答选择更合适的表达形式（Answer-first, not dashboard-first）**。

### 核心特性

| 特性 | 说明 |
| :--- | :--- |
| **按需可视化** | Agent 根据回答内容自动判断是否值得启用可视化，无需用户手动输入特定指令 |
| **A2UI 1.0 协议** | 使用标准协议消息与 26 个受控组件目录，依据官方 Schema 校验，拒绝直接注入原始 HTML |
| **组件级渐进式渲染** | 模型流式生成工具参数时，每闭合一个完整 JSON 值与组件即可逐步上屏，告别漫长白屏等待 |
| **轻量交互闭环** | 原生支持表格排序、图表悬停、滑块调参等本地交互，必要时可通过 `agent -> UI -> agent` 通道将操作回传 Agent |
| **历史一致性** | 每次调用生成自包含的回答快照，无需维护跨轮次状态即可由会话日志完整重放 |

---

## 快速开始

### 1. 安装插件

插件以 bundle 形式打包（`dsh.bundle` + `dsh.client`），仓库根目录就是可安装的包，构建产物已随仓库提交，安装时不需要现场编译。

- **从 GitHub 安装（推荐）**：`dsh plugin --profile desktop add github:ChimeSky/dsh-a2ui#v0.3.1`
- **冻结 tarball**：`dsh plugin --profile desktop add <绝对路径>/vendor/dsh-a2ui-0.3.1.tgz`，或运行 `tools/install.ps1`
- **插件管理器**：`plugin_manager action=install_bundle target=<绝对路径或 tarball 路径>`

把 `desktop` 换成目标 profile（Web 端通常为 `web`）。替换已安装的包之后，需要重启 DSH 才能加载新的 JavaScript 模块。

### 2. 正常提问

不需要加"画个图""做个表"之类的指令。当回答适合用界面表达时，Agent 会自己生成；简单问题仍然是文字。

生成后的表格可以点表头排序，图表可以悬停、切换图例，滑块与动画在本地重绘。只有 `action.event` 按钮或表单提交会向当前会话发送一条用户消息，把操作交回 Agent。

### 3. 从源码构建（可选）

```bash
git clone https://github.com/ChimeSky/dsh-a2ui.git
cd dsh-a2ui
npm install --ignore-scripts
npm run build
npm run all
```

`npm run all` 依次执行类型检查、构建、测试、bundle 校验、真实 React 渲染校验与 fresh-home 安装校验。

---

## 它如何判断

提示词要求 Agent 从回答内容判断，而不是等用户点名：

| 回答内容 | 生成的界面 |
|---|---|
| 3 行及以上可比较数据（方案、版本、条目、前后对比） | `Table`；2–4 个关键数字用 `Row` + `Stat` |
| 随时间变化、分类对比或占比 | `BarChart` / `LineChart` / `PieChart` |
| 目标、进度、覆盖率 | `Progress` / `Stat`（带趋势） |
| 值得读者自己试的参数或公式 | `Slider` + `Plot`（绑定数据模型） |
| 离散步骤、排序过程、算法演示 | `FramePlayer` |
| 需要用户填写或审批 | 表单组件 + 一个提交/审批按钮 |

**不生成**：单个事实、定义、是非题、寒暄、一两句解释、代码、diff、日志、路径。界面里已经展示的数字，不再在正文里重复一遍。

提示词常驻约 2.8 KB（约 700 tokens）；完整组件表通过 `a2ui_catalog` 按需拉取，不占常用上下文。

## 设计取舍：一次调用，一个独立快照

**One tool call, one self-contained UI snapshot.**

每次 `a2ui` 调用生成一张独立的卡片，只包含本次调用的消息。**跨调用修改历史卡片是有意不支持的**——后续轮次不能原地改写上一轮已经出现的界面。这样界面自然融入聊天记录，不需要跨轮次状态管理，历史回放也更直接、更可预测。

这不妨碍 A2UI 的增量消息：**同一次调用内**的 `createSurface → updateComponents → updateDataModel`（包括删除后重建）都会正确累积。

如果确实需要让读者看到变更后的界面，发送一个完整的 `createSurface`（组件与 `dataModel` 一起给出）即可：旧卡片保持原样，新卡片呈现新状态。

代价是每次变更多一张卡片；换来的是可预测的回放和零跨轮状态。

## 交互：本地优先

| 交互 | 行为 |
|---|---|
| 图表悬停 | 柱状图 / 折线图 / 饼图：高亮当前数据点并显示图内浮动提示；折线图按类别显示所有系列的值 + 竖向参考线；饼图切片外移、中心显示该切片数值与占比 |
| 图例点击 | 显示/隐藏某个系列（本地重绘） |
| 表格表头 | 点击排序（升序/降序/取消），`aria-sort` 同步 |
| 标签页 / 滑块 / 动画 | 切换、拖动重绘、播放暂停单步调速，全部本地 |
| `action.event` 按钮 | **只有这类按钮会向当前会话发送一条消息并开启新一轮**，悬停提示会明确写出这一点；提示词要求仅在用户明确要求提交/审批/刷新时生成 |

> 设计原则：能在本地做完的事，绝不发消息。只有 `action.event` 按钮或表单提交会向当前会话发送一条普通用户消息，并带上按当前数据模型求值的 `context`。

所有组件跟随 DSH 的明暗主题（`--dsw-alias-*` 变量），支持键盘操作与 ARIA 标签；窄屏下表格横向滚动、图表等比缩放。

## 组件

`catalogId` 默认 `dsh-a2ui/catalog/v1`（含下表全部组件）；也接受官方 basic catalog id（此时只允许前 18 个）。

### 官方 basic catalog（18）

`Text`、`Image`、`Icon`、`Video`、`AudioPlayer`、`Row`、`Column`、`List`、`Card`、`Tabs`、`Modal`、`Divider`、`Button`、`TextField`、`CheckBox`、`ChoicePicker`、`Slider`、`DateTimeInput`，以及 `checks` 校验规则（`required` / `regex` / `length` / `numeric` / `email`）：校验失败时按钮禁用并显示错误。

### 扩展 catalog（8）

| 组件 | 说明 |
|---|---|
| `Table` | 列声明 + 数据行；支持 `number` / `currency` / `percent` / `date` 格式化、对齐、横向滚动、40 行折叠 |
| `BarChart` | 分组 / 堆叠 / 横向柱状图 |
| `LineChart` | 折线、面积、平滑曲线、数据点 |
| `PieChart` | 饼图 / 环形图 + 图例百分比 |
| `Stat` | KPI 指标卡（值、单位、变化量、趋势色） |
| `Progress` | 进度条（`neutral` / `success` / `warning` / `danger`） |
| `Plot` | 安全算术表达式函数图（`a*x^2+b*x+c` 等），`variables` 可绑定数据模型实现本地重绘 |
| `FramePlayer` | 分步动画播放器（播放 / 暂停 / 单步 / 重置 / 调速，全部本地） |

`Plot` 的表达式由**自写解析器**求值：只接受数字、`x`、调用方变量、`+ - * / ^ %`、括号与固定数学函数（`sin`、`sqrt`、`max` 等）。白名单之外的标识符一律编译失败，**不使用 `eval` / `new Function`**。

### 数据绑定与函数

- 绑定：`{"@path": "/json/pointer"}`（模板子项内相对路径绑定到当前条目；`/` 开头为绝对路径）。
- 函数：`{"@call": "formatNumber", "args": {"value": {"@path": "/total"}, "decimals": 2}}`。
- 已实现官方函数：`required`、`regex`、`length`、`numeric`、`email`、`formatString`、`formatNumber`、`formatCurrency`、`formatDate`、`pluralize`、`openUrl`、`and`、`or`、`not`、`@index`。
- `formatString` 支持 `${/path}`、`${formatNumber(value:/total, decimals:0)}`、`${'字面量'}` 与 `\${` 转义。

## 需要时，把操作交回 Agent

点击带 `action.event` 的按钮或提交表单时，插件生成 A2UI 1.0 的 `action` 消息，并把一段以 `[A2UI action]` 开头的文本通过**当前会话的 Conversation 服务**作为一条普通用户消息入队。消息体包含 `name`、`surfaceId`、`sourceComponentId`、`timestamp`，以及按当前数据模型求值的 `context`。

- **走的是原生消息通道**：Host 的准入规则（会话是否运行中、队列上限、权限）与用户手动输入完全一致，界面无法绕过 DSH 权限。
- 只有 `action.event` 会打扰 Agent；`action.functionCall`（如 `openUrl`）只在浏览器本地执行。
- 历史回放不会自动重放任何 action：用户操作永远由一次真实点击触发。

## 兼容性与协议

| 项目 | 版本 |
|---|---|
| 实测 DSH | **0.2.2-rc.1**（Desktop / Web，Profile `desktop`） |
| `engines.dsh` | `>=0.2.2-rc.1 <0.3.0-0` |
| A2UI 协议 | **1.0**（`version: "1.0"`；v0.8 / v0.9 载荷会被明确拒绝并提示） |
| 规范来源 | `@a2ui/web_core@0.15.0`（Apache-2.0）中的 v1.0 zod schema 与 basic catalog 定义 |
| Node | ≥ 20（构建需要 `typescript`） |
| 浏览器侧 | 仅依赖 Harness 模块表提供的 `react` |

校验与渲染**依据 A2UI 1.0 官方 Schema 独立实现**，不是直接调用官方运行时校验器；消息类型、组件名、属性名与函数签名以官方定义为准，扩展组件通过标准 Catalog 机制声明（`catalogId`），不使用私有格式。

**为什么没有直接引用 `@a2ui/react`（0.15.0）**：它的 basic catalog 只有 18 个组件，没有 Table / Chart / Progress / Select，而本项目必须支持数据展示组件；它自带的 Material 风格组件与 `--dsw-alias-*` 主题体系冲突；它还依赖 `zod`、`markdown-it`，打进单文件客户端会显著增大体积。因此协议层、校验层与动作回传层均为独立实现，若要换用官方 Renderer，只需替换 `src/client/surface.tsx` 的组件分派层。

## 安全边界

| 风险 | 处理 |
|---|---|
| 模型输出 HTML / 脚本 | 文本一律走 React 文本节点；`md` 只生成 `<strong>/<em>/<code>/<br>`；bundle 中不存在 `dangerouslySetInnerHTML` |
| 任意代码执行 | 无 `eval` / `new Function`；`Plot` 使用白名单算术表达式解析器 |
| 恶意 URL | `safeMediaUrl` 只放行 `http(s)`（图片另加 `data:image/*;base64`）；`javascript:`、`file:`、`data:text/html` 全部拒绝；`openUrl` 需要用户手势 |
| 未知组件 / 属性 | 校验阶段拒绝并给出路径；渲染阶段再降级为可读占位符，不抛异常 |
| 超大 / 深层 / 环状图 | 消息数 32、单条组件 300、单表面 400、深度 64、字符串 16K、序列点数 500、帧数 400、载荷 384K；环检测 + 重复 ID 检测 |
| 展开后过大的界面 | 渲染前估算实际展开节点数与数据单元：单表面 > 4000 节点或 > 5000 数据单元、或一次调用跨表面合计 > 6000 / 6000，直接拒绝；Host 与客户端共用同一估算器 |
| 灾难性正则 | `regex` 按官方 §regex-safety-check 静态检查，拒绝反向引用 / 后向断言 / 命名组 / `\p{...}` / `\cX` / 内联旗标；输入上限 4096 码点；匹配由有界求值器执行 |
| 深层 JSON | `isJsonValue` 为迭代实现并限制 128 层，序列化前判定；11,000 层数组被拒绝而不是栈溢出 |
| 恶意 JSON Pointer | 路径长度 ≤ 1024、段数 ≤ 64、数组下标 ≤ 10000，禁止原型链段与稀疏写入，支持 `-` 追加；被拒绝的写入在 `updateDataModel.path` 上报关 |
| 越权操作 | 界面只能通过普通用户消息请求后续动作；文件、命令、网络等副作用仍由 Agent 走原有工具与审批 |
| 插件隔离 | 所有注册都通过 `ctx.effect` 归位；停用即移除视图 / 样式 / 词典 / 工具 / 提示词段 |

已知取舍：`Image` 允许 `https://` 外链，渲染时会向该地址发起请求（不发送任何凭据，`referrerPolicy="no-referrer"`）。完全离线时请只使用 `data:` 图片或本地文件引用。

## 设计边界与已知限制

### 有意不支持

- **跨调用原地更新历史卡片**：见[设计取舍](#设计取舍一次调用一个独立快照)。
- **`callRendererFunction` / `agentFunctionResponse`**：A2UI 1.0 的双向函数调用，需要 Agent 在两次工具调用之间回包，当前工具模型不提供该通道；发送会得到明确错误。

### 已知限制

- **流式预览是中间态**：`preparing` 阶段只画已闭合的组件，不校验整图、不可交互；调用进入 `start` / `result` 后换成校验后的快照。语法中途坏掉时预览退回骨架，最终错误仍由 Host 给出。
- **PTC / Code mode**：`run_code` 内的子调用会渲染为嵌套子行，未针对该形态做专门样式。
- **媒体依赖网络**（除 `data:` 图片外），离线环境下会显示加载失败占位。
- **模板子项内的相对绑定不可写**：编辑需要绝对路径（`/...`）。
- **`regex` 的匹配步数上限**：单次匹配上限 100,000 步；命中上限时返回 `valid: false`，极端长的非匹配输入可能被判为不合法（常见形状不受影响）。

## 架构

```text
DeepSeek Agent
   │  a2ui({ messages, title })
   ▼
Host  ──  依据 A2UI 1.0 Schema 校验（表面/组件/属性/绑定/深度/配额）
   │      工具结果：{ ok, surfaces, warnings }；meta 中留存可回放副本
   ▼
Session log（tool/call + tool/result.meta）  ← 唯一事实来源
   │
   ▼
Client ── tool.call.toolview(key="a2ui")
   │      1. 读取参数或 meta
   │      2. 再次校验 + applyMessageBatch 折叠出 SurfaceState
   │      3. 渲染组件树（本地数据模型状态）
   ▼
聊天界面（卡片内多 Surface）
   │  用户点击 / 提交
   ▼
conversation.send("[A2UI action] …")  →  当前会话 → Agent
```

三条实现约束：

1. **界面即日志**：一条工具调用 = 一次界面快照，渲染器只折叠这条调用自身的消息；无需插件私有存储，会话恢复就是重新渲染日志。
2. **两处校验，一份实现**：`src/shared` 同时被 Host 与浏览器引用，杜绝「服务端放过、前端崩溃」。
3. **零运行时依赖**：浏览器侧只 `require('react')`；图表是手写 SVG，无 CDN、无图表库、可离线渲染。

渐进式流式渲染的分片恢复、缓存上限、卡片宿主与副本认领等实现细节，见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 开发与测试

```bash
npm install --ignore-scripts     # typescript/@types + react/react-dom/jsdom（只用于测试与渲染校验）
npm run typecheck                # tsc --noEmit
npm run build                    # tsc + 模块链接器 → index.js, lib/**, client.js（写回仓库根目录）
npm test                         # 全部用例（node:test，进程内运行；含 jsdom DOM 用例）
npm run verify                   # 安装前的 bundle 不变量检查
npm run render                   # 真实 React 渲染校验（仓库内 fixture，不联网）
npm run pack:vendor              # 重新生成 vendor/dsh-a2ui-<version>.tgz
npm run all                      # 以上全部
```

当前验证规模：171 个自动化用例（含 18 个 jsdom DOM 用例、27 个流式用例、43 个官方样例）、19 个真实 React 渲染用例、32 项 bundle 不变量。详细结果与「真实 DSH 中验证 / 仅无头验证」的分界见 [docs/TEST-REPORT.md](docs/TEST-REPORT.md)，逐版本变更见 [CHANGELOG.md](CHANGELOG.md)。

`index.js`、`lib/**`、`client.js` 是构建产物，随仓库提交，便于 `dsh plugin add github:` 直接安装；改源码后重新执行 `npm run build` 再提交。构建不会删除任何文件，也不会使用 esbuild（受限沙箱禁止其原生服务所需的管道）。

## 许可与归属

- 本插件代码：MIT（见 [LICENSE](LICENSE)）。
- A2UI 协议规范、catalog 标识与组件/函数命名来自 A2UI 项目（Copyright 2024 Google LLC，Apache-2.0）。本包未复制其源代码，只按官方 Schema 重新实现校验与渲染，归属声明见 [NOTICE](NOTICE)。
- DSH 侧仅使用公开扩展点，未修改或内联 Harness 源码。
