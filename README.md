# dsh-a2ui — Generative UI for DeepSeek Harness

[![CI](https://github.com/ChimeSky/dsh-a2ui/actions/workflows/ci.yml/badge.svg)](https://github.com/ChimeSky/dsh-a2ui/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-8A2BE2)](https://github.com/topics/dsh-plugin)
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

*Bring interactive, agent-generated interfaces into DeepSeek Harness through the Google A2UI protocol.*

**简体中文** | [English](README.en.md)

---

## 一、它是什么

`dsh-a2ui` 是一个可安装的 DeepSeek Harness（DSH）插件。它把 **Google A2UI 1.0**（Agent-to-User Interface）协议接到 DSH 的对话界面上：

- Agent 在对话中调用 `a2ui` 工具，提交一组 **A2UI 1.0 消息**；
- 插件在 Host 侧按官方 Schema 校验（表面 ID、组件图、属性、数据绑定、资源上限）；
- 客户端在**对话消息流内**把它渲染为原生风格的卡片、表格、图表、表单、滑块、动画等；
- 用户点击按钮 / 提交表单后，插件把 A2UI `action` 事件作为一个普通的用户消息回传给当前会话，Agent 继续处理。

渲染完全由**会话日志中的工具调用**决定：没有插件私有状态的持久化，重开历史会话即可恢复界面，历史回放不会重复触发任何动作。

> 这是**协议实现**，不是自定义 HTML/JSON 的仿制品。所有消息类型、组件名、属性名、函数签名均取自 A2UI v1.0 官方 Schema（见[兼容性](#九兼容性)），扩展组件通过**自定义 Catalog** 声明，而不是绕过协议。

---

## 二、当前状态（v0.2.1）

> 本版为**正确性与安全**版本：对齐 A2UI 1.0 规范（官方 43 个 catalog 样例全部通过）、构建不再删除任何文件、正则改为有界求值。完整条目见 [CHANGELOG.md](CHANGELOG.md)。

| 能力 | 状态 |
|---|---|
| Host 工具注册（`a2ui`、`a2ui_catalog`） | 已实现 |
| A2UI 1.0 消息校验（`createSurface` / `updateComponents` / `updateDataModel` / `deleteSurface`） | 已实现 |
| 对话流内原生渲染（`tool.call.toolview`） | 已实现 |
| 官方 basic catalog 全部 18 个组件 | 已实现 |
| 扩展 catalog：Table / Bar / Line / Pie / Stat / Progress / Plot / FramePlayer | 已实现 |
| 数据模型绑定 + 本地函数（formatString、formatNumber、校验函数等） | 已实现 |
| 双向交互（按钮 / 表单 → 当前会话 → Agent） | 已实现 |
| 多 Surface 并存、同一次调用内增量更新 | 已实现 |
| 会话恢复、历史回放无副作用 | 已实现（由日志推导） |
| 明暗主题、响应式、键盘可达、ARIA 标签 | 已实现（样式走 `--dsw-alias-*` 主题变量） |
| 逐字流式渲染（边生成边画） | 部分：工具调用进入 `start` 阶段即渲染，之后可再次调用工具增量更新；不做逐字符解析 |
| 跨工具调用「原地替换已有卡片」 | 未实现（见[已知限制](#十已知限制)） |
| `callRendererFunction` / `agentFunctionResponse` 消息 | 未支持（0.2.1 明确拒绝，报错文案说明原因） |
| PTC（Code mode）下的 `run_code` 子调用渲染 | 部分：会渲染为子调用行，样式未专门优化 |

---

## 三、安装与启停

插件以 **bundle** 形式打包（`dsh.bundle` + `dsh.client`）：仓库根目录就是可安装的包，Host 与浏览器两个半边由同一个包提供，构建产物已随仓库提交，安装时不需要现场编译。

### 方式 A：从 GitHub 安装（推荐）

在 DSH 中执行 `dsh plugin --profile desktop add github:ChimeSky/dsh-a2ui#v0.2.1`。`#v0.2.1` 把安装固定到发布标签，`desktop` 按目标 profile 替换（Web 端通常为 `web`）。

### 方式 B：用冻结的 tarball 安装

`vendor/dsh-a2ui-0.2.1.tgz` 与发布测试过的字节一致：`dsh plugin --profile desktop add <绝对路径>/vendor/dsh-a2ui-0.2.1.tgz`。也可以运行 `tools/install.ps1`，它负责安装、卸载与安装副本校验。

### 方式 C：在 DSH 插件管理器中安装

让 Agent 或插件管理界面执行 `plugin_manager action=install_bundle target=<绝对路径或 tarball 路径>`。安装后 bundle 会写入当前 Profile（桌面端为 `desktop`），并出现在「设置 → 插件」列表中。插件通过 HMR 生效；替换已安装包后需要重启以加载新的 JavaScript 模块。

### 启用 / 停用 / 卸载

- 停用：`plugin_manager action=set_plugin target=dsh-a2ui enabled=false`（或设置页开关）。停用后：两个工具不再对模型可见，提示词段消失，聊天视图不再注册，样式与词典随 `ctx.effect` 清理——正常对话不受影响。
- 启用：`enabled=true`。
- 卸载：`plugin_manager action=remove_bundle target=dsh-a2ui`。

### 目录说明

| 路径 | 作用 |
|---|---|
| `index.js`、`lib/**` | Host 入口与协议/工具模块（构建产物，勿手改） |
| `client.js` | 浏览器 bundle（模块表加载） |
| `cordis.patch.yml` | bundle patch，插入 `dsh-a2ui` 行 |
| `locale/`、`icon.svg` | 插件显示元数据与图标 |
| `src/host/`、`src/shared/`、`src/client/` | TypeScript 源码 |
| `tests/` | 用例（协议 / 单元 / 集成 / 验收） |
| `tools/` | 构建、测试、校验、安装、打包脚本 |
| `vendor/` | 冻结的安装 tarball |
| `docs/` | 实现说明与测试报告 |

---

## 四、Agent 如何生成界面

插件向模型提供两个工具和一段简短的提示词：

- **`a2ui`** — 提交 A2UI 1.0 消息数组。
  参数：`messages: object[]`（必填）、`title?: string`。返回：`{ ok, surfaces[], warnings[], note }`。
- **`a2ui_catalog`** — 按需返回组件/函数参考（`detail: "brief" | "full"`）。提示词只给「何时用 UI」的规则，完整组件表按需拉取，避免长期占用上下文。

提示词段明确要求：**解释性内容用 Markdown，只有「看比读更好」时才生成界面**（数据对比、图表、指标、可调参数、结构化表单、分步动画、审批按钮），并且不要在文字里重复界面已展示的数值。

### 触发策略（默认主动，`autoRender: true`）

**不需要用户说"画个图""用 a2ui""可视化"**。提示词要求模型从*回答内容*判断，命中即生成：

| 内容特征 | 自动生成 |
|---|---|
| 3 行及以上可比较数据（方案、版本、条目、前后对比） | `Table`；2–4 个关键数字用 `Row` + `Stat` |
| 随时间变化 / 分类对比 / 占比 | `BarChart` / `LineChart` / `PieChart` |
| 目标、进度、覆盖率 | `Progress` / `Stat`（带趋势） |
| 值得读者自己试的参数、公式 | `Slider` + `Plot`（绑定数据模型） |
| 离散步骤、排序过程、算法演示 | `FramePlayer` |
| 需要用户填写或审批 | 表单组件 + 一个提交/审批按钮 |

**不生成**：单个事实、定义、是非题、寒暄、一两句解释、代码、diff、日志、路径。并禁止"同一组数字既画图又写表格"。

代价：该提示词段约 2.8 KB（≈700 tokens）常驻；`a2ui_catalog` 仍按需拉取。

| 配置项 | 默认 | 说明 |
|---|---|---|
| `autoRender` | `true` | `false` 时改为「仅在用户要求或内容明显需要时才生成」，提示词与工具描述同步收紧 |
| `catalogTool` | `true` | 是否注册 `a2ui_catalog` 参考工具 |
| `sectionOrder` | `120` | 提示词段在 system prompt 中的顺序 |
| `muteSection` | `false` | 完全关闭提示词段（只保留工具） |
| `toolName` | `a2ui` | **不建议改**：客户端的内联工具行按该名字注册视图；改名后卡片仍会渲染在轮末（按 `meta.kind === "a2ui"` 匹配），但过程行会退化为通用工具行 |

### 示例

一条调用即可组合出完整界面：卡片、`ChoicePicker` 与 `Button` 构成方案选择；`BarChart` 与 `LineChart` 共用同一数据模型；`Slider` 绑定 `Plot` 的 `variables`，拖动即本地重绘；`FramePlayer` 播放预先算好的分步动画。具体参数、组件属性与可选值以 `a2ui_catalog` 的 `full` 输出为准。

---

## 五、用户操作如何回到 Agent

点击带 `action.event` 的按钮、或提交表单时，插件生成 A2UI 1.0 的 `action` 消息，并把一段以 `[A2UI action]` 开头的文本通过**当前会话的 Conversation 服务**作为一条普通用户消息入队。消息体包含 `name`、`surfaceId`、`sourceComponentId`、`timestamp`，以及按当前数据模型求值的 `context`。

要点：

- **走的是原生消息通道**，因此 Host 的准入规则（会话是否运行中、队列上限、权限）与用户手动输入完全一致；不存在绕过 DSH 权限的旁路。
- `context` 中的绑定值在点击时按**当前数据模型**求值，所以表单里改过的值一定会带上。
- 只有 `action.event` 会打扰 Agent。`action.functionCall`（如 `openUrl`）只在浏览器本地执行，不产生模型调用。
- 历史回放不会自动重放任何 action：用户操作永远由一次真实点击触发。

---

## 六、交互（默认全部本地，不打扰 Agent）

| 交互 | 行为 |
|---|---|
| 图表悬停 | 柱状图 / 折线图 / 饼图：高亮当前数据点并显示 SVG 内浮动提示；折线图按类别显示所有系列的值 + 竖向参考线；饼图切片外移、中心显示该切片数值与占比 |
| 图例点击 | 显示/隐藏某个系列（本地重绘） |
| 表格表头 | 点击排序（升序/降序/取消），`aria-sort` 同步 |
| 标签页 / 滑块 / 动画 | 切换、拖动重绘、播放暂停单步调速，全部本地 |
| `action.event` 按钮 | **只有这类按钮会向当前会话发送一条消息并开启新一轮**，悬停提示会明确写出这一点；提示词要求仅在用户明确要求提交/审批/刷新时生成 |

> 设计原则：能本地做完的事绝不发消息。表格排序、图例开关、悬停提示、标签切换、滑块重绘都是纯前端状态，不产生模型调用。

## 七、支持的组件

`catalogId` 默认 `dsh-a2ui/catalog/v1`（含下表全部组件）；也接受官方 basic catalog id（此时只允许前 18 个）。

### 官方 basic catalog（18）

| 组件 | 说明 |
|---|---|
| `Text` | 段落 / 说明文字，支持 `**粗体**`、`*斜体*`、`` `代码` `` 与换行（渲染为 React 文本节点，不解析 HTML） |
| `Image` / `Icon` / `Video` / `AudioPlayer` | 媒体（URL 仅放行 http(s)；图片额外允许 `data:image/*` base64） |
| `Row` / `Column` / `List` | 布局，支持 `justify` / `align` / `weight`（flex-grow） |
| `Card` / `Divider` | 容器与分隔线 |
| `Tabs` / `Modal` | 标签页；模态框（Esc 关闭、焦点语义 `role="dialog"`） |
| `Button` | `default` / `primary` / `borderless`，支持 `action.event` 与 `action.functionCall` |
| `TextField` | `shortText` / `longText` / `number` / `obscured` |
| `CheckBox` / `ChoicePicker` / `Slider` / `DateTimeInput` | 表单控件，绑定到数据模型后可本地实时更新 |
| `checks` | 输入校验（`required` / `regex` / `length` / `numeric` / `email`），失败时按钮禁用并显示错误 |

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

> `Plot` 的表达式由**自写解析器**求值：只接受数字、`x`、调用方变量、`+ - * / ^ %`、括号与固定数学函数（`sin`、`sqrt`、`max`…）。`this`、`window`、`constructor`、函数调用白名单之外的标识符一律编译失败。**不使用 `eval` / `new Function`**。

### 数据绑定与函数

- 绑定：`{"@path": "/json/pointer"}`（模板子项内相对路径绑定到当前条目；`/` 开头为绝对路径）。
- 函数：`{"@call": "formatNumber", "args": {"value": {"@path": "/total"}, "decimals": 2}}`。
- 已实现官方函数：`required`、`regex`、`length`、`numeric`、`email`、`formatString`、`formatNumber`、`formatCurrency`、`formatDate`、`pluralize`、`openUrl`、`and`、`or`、`not`、`@index`。
- `formatString` 支持 `${/path}`、`${formatNumber(value:/total, decimals:0)}`、`${'字面量'}` 与 `\${` 转义。

---

## 八、架构

```text
DeepSeek Agent
   │  a2ui({ messages, title })
   ▼
Host  ──  Catalog + Schema 校验（表面/组件/属性/绑定/深度/配额）
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

关键设计选择：

1. **界面即日志**。一条工具调用 = 一次界面快照；渲染器只折叠这条调用自身的消息。因此无需插件私有存储，会话恢复就是重新渲染日志，回放天然幂等。
2. **两处校验，一份实现**。`src/shared` 同时被 Host 与浏览器引用，杜绝「服务端放过、前端崩溃」。
3. **状态在浏览器内存里派生**。滑块的编辑写入组件本地的数据模型副本（copy-on-write），不触碰日志，也不会造成重复渲染。
4. **零运行时依赖**。浏览器侧只 `require('react')`；图表是手写 SVG，无 CDN、无 ECharts、可离线渲染。

---

## 九、安全边界

| 风险 | 处理 |
|---|---|
| 模型输出 HTML / 脚本 | 文本一律走 React 文本节点；`md` 只生成 `<strong>/<em>/<code>/<br>`；bundle 中不存在 `dangerouslySetInnerHTML` |
| 任意代码执行 | 无 `eval` / `new Function`；`Plot` 使用白名单算术表达式解析器 |
| 恶意 URL | `safeMediaUrl` 只放行 `http(s)`（图片另加 `data:image/*;base64`）；`javascript:`、`file:`、`data:text/html` 全部拒绝；`openUrl` 需要用户手势 |
| 未知组件 / 属性 | 校验阶段拒绝并给出路径；渲染阶段再降级为可读占位符，不抛异常（渲染器抛错会整块空白） |
| 超大 / 深层 / 环状图 | 消息数 32、单条组件 300、单表面 400、深度 64、字符串 16K、序列点数 500、帧数 400、载荷 384K；环检测 + 重复 ID 检测 |
| 展开后过大的界面 | 渲染前估算**实际展开节点数**（模板按数据长度相乘）与数据单元（表格行 + 图表点 + 动画帧项 + Plot 散点）：单表面 > 4000 节点或 > 5000 数据单元、或一次调用跨表面合计 > 6000 节点 / > 6000 数据单元，直接拒绝；Host 与客户端用同一估算器 |
| 灾难性正则 | `regex` 按官方 §regex-safety-check 的四条规则静态检查（>256 码点、有界量词套无界量词、无界量词套同首字符分支、相邻无界量词字符集重叠），并拒绝反向引用 / 后向断言 / 命名组 / `\p{...}` / `\cX` / 内联旗标；输入上限 4096 码点；字面量在**校验期**报错，动态求值在**执行期**拒绝 |
| 深层 JSON | `isJsonValue` 为迭代实现并限制 128 层，序列化前先判定；11,000 层数组被拒绝而不是栈溢出 |
| 恶意 JSON Pointer | 路径长度 ≤ 1024、段数 ≤ 64、数组下标 ≤ 10000，禁止 `__proto__` / `prototype` / `constructor`，拒绝稀疏写入（越界下标不会创建空洞数组），支持 `-` 追加；被拒绝的写入会在 `updateDataModel.path` 上报关，不再谎报成功 |
| 越权操作 | 界面只能通过普通用户消息请求后续动作；文件、命令、网络等副作用仍由 Agent 走原有工具与审批 |
| 插件隔离 | 所有注册都通过 `ctx.effect` 归位；停用即移除视图 / 样式 / 词典 / 工具 / 提示词段 |

已知取舍：`Image` 允许 `https://` 外链，因此渲染时会向该地址发起请求（不发送任何凭据，`referrerPolicy="no-referrer"`）。如需完全离线，请只使用 `data:` 图片或本地文件引用。

---

## 十、兼容性

| 项目 | 版本 |
|---|---|
| 实测 DSH | **0.2.2-rc.1**（Desktop / Web，Profile `desktop`） |
| `engines.dsh` | `>=0.2.2-rc.1 <0.3.0-0` |
| A2UI 协议 | **1.0**（`version: "1.0"`；v0.8 / v0.9 载荷会被明确拒绝并提示） |
| 规范来源 | `@a2ui/web_core@0.15.0`（Apache-2.0）中的 v1.0 zod schema 与 basic catalog 定义 |
| Node | ≥ 20（构建需要 `typescript`） |
| 浏览器侧 | 仅依赖 Harness 模块表提供的 `react` |

**为什么没有直接引用 `@a2ui/react`（0.15.0）**：

1. 它的 basic catalog 只有 18 个组件，**没有 Table / Chart / Progress / Select**，而本项目必须支持数据展示组件；官方图表 catalog（`@a2ui/catalog-vegachart`）尚未发布。
2. 它自带一套 Material 风格组件与 CSS，直接嵌入 DSH 聊天流会与 `--dsw-alias-*` 主题体系冲突，无法满足「与原生界面高度一致」。
3. 它依赖 `react` 18/19 + `zod` + `markdown-it`，打进单文件客户端 bundle 会显著增大体积，而 DSH 模块表只稳定提供 `react`。

因此本项目**按 v1.0 官方 Schema 独立实现**校验与渲染，并把官方 catalog id 与组件/函数命名作为兼容基线；扩展通过标准 Catalog 机制声明（`catalogId`），而不是私有格式。若要换用官方 Renderer，只需替换 `src/client/surface.tsx` 的组件分派层——协议层、校验层、动作回传层无需改动。

---

## 十一、已知限制

1. **渲染位置与"永不会消失"保证**：卡片有两个宿主 ——
   - **轮末（主会话流）**：`conversation.chat.turnTail`，落在该轮回答之后，不随过程区折叠；
   - **过程行**：`tool.call.toolview`，用于工具进行中的内联渲染，以及轮末被卸载时的兜底。

   两者通过**副本认领（claims）**协调：轮末副本挂载时认领该调用，过程行退化为一行指针；轮末副本一旦卸载（翻页、新一轮、轮次中止等任何原因），认领立即释放，过程行**自动恢复完整卡片**。因此界面不会因为轮次生命周期而丢失——最坏情况是退回到可展开的过程区，而不是消失。
2. **每张卡片只包含本次调用的消息**。一次工具调用 = 一张自包含卡片：渲染器只折叠这条调用自身的消息，因此同一次调用内的 `createSurface → updateComponents → updateDataModel` 会正确累积（含删除后重建），但**跨调用**的 `updateComponents` / `updateDataModel` / `deleteSurface` 不会修改上一轮已经渲染的卡片——它只会渲染成一条「界面已更新」提示，而不是原地替换。
   - 想让读者看到**变更后的界面**，请发送**完整的** `createSurface`（组件 + `dataModel` 一起给出），参见[示例 1](#示例-1交互卡片)；
   - 想移除旧卡片，请在**同一次调用**内 `deleteSurface` 后重建；
   - 真正的跨调用实时 Surface 生命周期需要 DSH 会话投影改造，属于独立议题，当前保持上述快照契约（该行为有 8 条回归测试锁定）。
3. **不做逐字符流式解析**。工具进入 `start` 阶段（参数收完）即渲染；`preparing` 阶段显示骨架。模型可以在同一轮里连续调用工具实现「先框架、后数据」的增量效果。
4. **`callRendererFunction` / `agentFunctionResponse` 未支持**。它们属于 A2UI 1.0 的双向函数调用，但需要 Agent 侧在两次工具调用之间回包，当前工具模型不提供该通道；发送这些消息会得到明确错误。
5. **PTC / Code mode**：`run_code` 内的子调用会被渲染为嵌套子行，未针对该形态做专门样式。
6. **图片 / 视频 / 音频依赖网络**（除 `data:` 图片外），离线环境下会显示加载失败占位。
7. **模板子项内的相对绑定不可写**：编辑需要绝对路径（`/...`），否则控件保持只读语义。
8. **`regex` 的匹配步数上限**：安全子集内的模式由有界求值器执行，单次匹配上限 100,000 步。命中上限时返回 `valid: false` 并附 `pattern exceeded the match work limit` 说明——极端长的**不匹配**输入可能因此被判为不合法（常见形状不受影响：贪心优先的求值顺序让正常输入无需回溯穷举）。需要更宽松的语义时，可配合输入上限（4096 码点）调高该常量。

---

## 十二、开发

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

> **构建不会删除任何文件。** 编译器只在内存中 emit，链接与 `lib/**` 写回都由本次 emit 清单驱动；若 `lib/` 里残留了不再属于任何模块的文件，构建会**列出它们的完整路径**而不是替你删除——需要清理时请自己对明确的单个文件执行 `Remove-Item "路径"`。
>
> 构建不使用 esbuild：受限沙箱禁止其原生服务所需的管道（`spawn EPERM`）。`tools/build.mjs` 用 TypeScript 编译器 API 在进程内编译，再用约 120 行的模块注册链接器把浏览器半边合成单文件，并包进 `__ModuleLoader__.load({ id, factory })`。`npm test` 也用 `tools/run-tests.mjs` 在单进程内加载测试，避免 `node --test` 为每个文件 spawn 子进程。`index.js`、`lib/**`、`client.js` 是构建产物，随仓库提交，便于 `dsh plugin add github:` 直接安装；改源码后重新执行 `npm run build` 再提交。
>
> 官方 catalog 样例固定保存在 `tests/fixtures/examples`（commit `58379ad`），由 `npm test` 全量校验；`tools/fetch-fixtures.mjs` 可重新下载。

---

## 十三、验收测试结果

见 [docs/TEST-REPORT.md](docs/TEST-REPORT.md)：包含验收场景的实测结论、130 个自动化用例（含 10 个 jsdom DOM 用例与 43 个官方样例）、11 个真实 React 渲染用例，以及「已在真实 DSH Desktop 中验证」与「仅无头验证」的明确分界。逐版本变更见 [CHANGELOG.md](CHANGELOG.md)。

---

## 十四、许可与归属

- 本插件代码：MIT（见 [LICENSE](LICENSE)）。
- A2UI 协议规范、catalog 标识与组件/函数命名来自 A2UI 项目（Copyright 2024 Google LLC，Apache-2.0）。本包**未复制**其源代码，只按官方 Schema 重新实现校验与渲染，归属声明见 [NOTICE](NOTICE)。
- DSH 侧仅使用公开扩展点，未修改或内联 Harness 源码。
