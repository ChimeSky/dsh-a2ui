# dsh-a2ui — 测试与验证报告

生成时间：2026-11-12
被测版本：`dsh-a2ui@0.1.0`

## 一、环境

| 项目 | 值 |
|---|---|
| DeepSeek Harness | 0.2.2-rc.1（Desktop，Profile `desktop`，`patchReload: live`） |
| 运行平台 | Windows 10.0.26200，Node.js v24.11.1 |
| A2UI 协议 | 1.0（校验规则取自 `@a2ui/web_core@0.15.0` 的 v1.0 schema 与 basic catalog 定义） |
| 安装方式 | `plugin_manager install_bundle` → 目录链接 `link:C:/Users/ChimeSky/Desktop/DSH/plugins/a2ui/package` |
| 构建 | `tsc`（进程内 API）+ 自写模块链接器；无 esbuild（沙箱禁止其原生服务的管道，`spawn EPERM`） |

## 二、自动化测试

命令：`npm run all`（= typecheck → build → test → verify）

| 项目 | 结果 |
|---|---|
| TypeScript 类型检查（`strict`） | ✅ 0 错误 |
| 构建 | 22 个模块；`client.js` 202 KiB；`lib/**` + `index.js` |
| 单元/集成/验收用例 | ✅ **70 / 70 通过**（`node:test`，`duration ≈ 100 ms`） |
| Bundle 不变量检查 | ✅ **29 / 29 通过** |

用例分布：

| 文件 | 数量 | 覆盖内容 |
|---|---|---|
| `tests/protocol.test.mjs` | 22 | 信封（version/单一 message key/未知字段）、未知组件与属性、缺 `root`、悬空引用、环、重复 ID、`Surface` 误用、目录不匹配、未知 catalog、`updateComponents` 合并语义、`updateDataModel` 指针写入/删除、`deleteSurface`、多 surface 隔离、模板子列表、消息数/字符串长度上限、v0.8/v0.9 载荷拒绝、`callRendererFunction` 明确拒绝 |
| `tests/unit.test.mjs` | 14 | JSON Pointer 读写（copy-on-write、`~0/~1` 转义）、字面量/绑定/函数调用解析、模板内相对绑定、模板展开上限、`formatString`（路径/嵌套调用/字面量/转义/畸形输入）、数字/货币/日期/复数格式化、5 个校验函数、action context 解析、表达式求值与拒绝（`this`/`window.constructor`/`x[0]`/`x;y`/超长）、26 个组件逐一最小样本校验通过、catalog 文档包含全部组件与函数且体积 < 8 KB |
| `tests/integration.test.mjs` | 12 | Host 插件形态与 `inject`、两个工具 + 一个 prompt 段的注册、`muteSection`/`catalogTool:false`、成功执行与摘要渲染、失败时的路径化报错、超大可回放副本降级、`a2ui_catalog` 输出、effect 清理（生命周期）、URL/SVG 准入、浏览器 bundle 经 `vm` + React stub 加载并注册 `tool.call.toolview(key="a2ui")`、bundle 中无 `eval`/`new Function`/`dangerouslySetInnerHTML`、外部依赖仅 `react` |
| `tests/turn-tail.test.mjs` | 6 | 轮末转录查询：仅取本轮、跳过隐藏节点、结果阶段从 `call.name` 取名、非 a2ui 排除、store/order 缺失返回空、Map 与普通对象兼容 |
| `tests/claims.test.mjs` | 5 | 副本认领：会话/调用隔离、嵌套认领与幂等释放、缺失标识不认领、订阅通知与退订、订阅者抛错不影响已记录的认领 |
| `tests/acceptance.test.mjs` | 9 | 见下节验收场景 1–9 |

**第 8 条需求（交互性）的验证方式**：图表悬停、图例开关、表头排序都是纯客户端状态，无法在无头环境断言像素；已通过 8 个 SSR 渲染用例确认「带交互逻辑的组件树仍能完整渲染且不抛异常」，交互行为本身需要人眼确认（见第五节）。

## 三、验收场景

| # | 场景 | 自动化验证 | 结论 |
|---|---|---|---|
| 1 | 文字 + 按钮 + 选择框的交互卡片 | 卡片 13 组件图校验通过；`ChoicePicker` 绑定值经 action context 正确解析为 `{plan:['pro']}` | ✅ 数据链路通过；像素见「未验证」 |
| 2 | 月度销售柱状图 + 折线图 | 两图共用 `{"@path":"/revenue"}` 绑定，数据模型与 series 一致 | ✅ |
| 3 | 二次函数 a/b/c 参数可视化 | 三个 Slider 写模型 → `Plot.variables` 解析为 `{a:2,b:0,c:-4}` → 表达式 `2x²-4` 在 x=1 时得 -2；原模型未被修改 | ✅ 本地重绘本路径通过 |
| 4 | 冒泡排序交互动画 | 4 帧 `FramePlayer` 校验通过，帧状态（compare/active/sorted）保真 | ✅ 帧数据通过；播放动画见「未验证」 |
| 5 | 学习计划表单 → Agent 继续 | 填表后 action context = `{level:['beginner'],hours:8,goal:'…',algorithms:true}`；`userMessage` 解析正确 | ✅ |
| 6 | 会话恢复 | 同一批消息重复校验/折叠结果一致；输入载荷未被修改（JSON 快照相同）；重复折叠幂等 | ✅ 逻辑层；GUI 重开见「未验证」 |
| 7 | 普通对话兼容性 | Host 仅注册 2 个工具 + 1 个 prompt 段（精确断言），不触碰 Markdown/输入框/其他工具；停用后 prompt 段与工具消失（已在真实会话中观察） | ✅ |
| 8 | 异常与安全输入 | `<script>`、`javascript:`、`__proto__` 等作为文本被原样保留并以文本节点渲染；恶意 URL 被 `safeMediaUrl` 拒绝；未知组件/属性、`dangerouslySetInnerHTML`、v0.8 载荷全部拒绝 | ✅ |
| 9 | 多会话隔离 | 两个会话各自折叠同名 `surfaceId`，互不影响；更新一方不影响另一方 | ✅ |
| 10 | 插件生命周期 | effect 清理后工具与 prompt 段归零；真实环境中 bundle 停用→槽位 occupant 消失、启用→重新出现 | ✅ |

## 四、真实 DSH 桌面端验证（未使用无头替代）

以下证据均来自本次运行中的 Desktop 实例：

1. **工具已对模型可见**：`a2ui`、`a2ui_catalog` 出现在本会话的可用工具表中，工具描述与参数 Schema 即本插件注册内容。
2. **提示词段已注入**：本会话 system prompt 中出现 「Generative UI (A2UI 1.0)」段（由 `ctx.systemPrompt.section` 提供）。
3. **Catalog 工具可用**：`a2ui_catalog(detail="brief")` 返回 26 个组件的参考文本。
4. **校验闭环生效**：首次提交包含 `Progress.max: {"@path":"/total"}` 的载荷被拒绝，返回
   `- /messages/0/createSurface/components/7/max: must be a finite number (got object)`；修正后同一轮内重新提交成功——即设计中的「报错 → 修正 → 重试」循环。
5. **渲染调用成功**：返回 `Rendered surface "activation" (13 components).`
6. **可回放副本已落盘**：直接解码会话日志 `session.v4.jsonl.zstd` 后可见该调用的 `tool/result`：
   `meta.kind=a2ui`、`title="dsh-a2ui 激活验证"`、`surfaces=1`、可回放消息 1 条、`version=1.0`、`surfaceId=activation`、13 个组件、`catalogId=dsh-a2ui/catalog/v1`。
   这正是浏览器在历史页/重开时读取的数据，因此「会话恢复」不依赖任何插件私有状态。
7. **浏览器半边已注册**：Client 槽位检查显示 `tool.call.toolview` 的 keyed occupant 列表中存在 `key: "a2ui", active: true`。
8. **生命周期无残留**：停用 bundle 后，该 occupant 消失、prompt 段从下一轮消失；重新启用后二者恢复。停用期间其他工具（`cordis_*`、`skill`、`present` 等，其 registrant 同为 `tk`）不受影响，说明占位消失确由本插件导致。
9. **交互闭环（真人点击，已实测）**：在仪表盘上点击「刷新」后，Agent 收到一条完整用户消息：
   `[A2UI action] 刷新 dsh-a2ui 项目仪表盘` + 紧随其后的
   `{"version":"1.0","action":{"name":"refresh-dashboard","surfaceId":"status","sourceComponentId":"refresh","timestamp":"2026-11-12T13:38:18.900Z","context":{"scope":"all"},"userMessage":"…"}}`。
   即：按钮 → 协议 `action` 消息 → 普通用户消息入队 → Agent 处理，全链路成立。
10. **失败重试回路（实测）**：同一轮内我两次把 `caption` 写到 `Progress` 上，工具两次返回精确路径
    `/messages/0/createSurface/components/7/caption: is not a property of Progress`，第三次改正后成功渲染。
11. **轮末渲染（turnTail，已实现并通过 SSR 渲染验证）**：新增 `conversation.chat.turnTail` 条目；用真实日志载荷渲染得到 2840 字节 HTML（完整卡片），「进程行」在轮次结束后退化为 222 字节的一行指针，二者不重复。是否真的出现在浏览器主会话流中，需要一次页面刷新后由人确认（见第五节）。

## 五、未验证项（如实说明）

| 项目 | 原因 |
|---|---|
| 视觉呈现（配色、间距、图表外观、明暗主题切换、窄窗口表现） | 当前会话无法读取浏览器 DOM/截图；样式全部使用 `--dsw-alias-*` 主题变量并通过 bundle 检查，但**外观未经人眼确认** |
| 轮末（turnTail）卡片在真实浏览器中的落位 | 已有 8 个 SSR 渲染用例（含轮末与指针形态）证明不抛错、内容正确，但「是否真的出现在主会话流中」需要一次页面刷新后由人确认 |
| 关闭/重开 DSH 后界面恢复 | 需要重启应用；已证明可回放副本存在且渲染器只依赖该副本 |
| 两个真实会话并排的视觉隔离 | 仅逻辑层验证 |
| `FramePlayer` 动画时序、`Slider` 拖动实时重绘的流畅度 | 需要真实浏览器交互 |

## 六、开发过程中发现并修复的问题

| # | 问题 | 处理 |
|---|---|---|
| 1 | 插件激活失败：`cannot get property "systemPrompt" without inject` | `inject` 增加 `systemPrompt`；移除未声明的 `ctx.logger` 访问 |
| 2 | 沙箱内 `esbuild`/`node --test` 均因 `spawn EPERM` 失败 | 改用 TypeScript 编译器 API + 自写模块链接器；测试改为单进程加载 |
| 3 | 模块链接器不支持 `export * from` | 增加 `Object.assign(exports, require(...))` 转换 |
| 4 | `formatString` 的 `${/path}` 无法解析 | 标识符字符集补入 `/`、`~` |
| 5 | 表达式语言接受 `this` 等宿主标识符 | 增加保留字黑名单（`this`/`window`/`constructor`/`eval`…） |
| 6 | `Progress.max` 被误当作可绑定属性（真实调用中暴露） | 保留为字面量，并在错误信息中给出精确路径 |

## 七、复现命令

```bash
npm install --ignore-scripts
npm run all
npm run inspect:session     # 打印最近会话中 a2ui 调用的 meta 与可回放副本
```
