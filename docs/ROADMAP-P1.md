# P1 扩展规划（MVP 验收后）

> 本文是「下一步做什么」的决策文档。MVP 的交付边界见 [BACKLOG.md](BACKLOG.md)，
> 本文负责把候选方向排成有依据的顺序，并为每一项写清 范围 / 输入输出 / 验收标准。
>
> 状态标记：`已实现` / `进行中` / `待设计确认` / `排队`

---

## 0. 排序依据

MVP 已经跑通「选文件 → 判定 → 转码 → 校验」主链路，因此下一阶段的取舍不按
「功能多少」排，而按四个维度打分：

| 维度 | 含义 |
|---|---|
| **价值** | 用户是否真的会因此少做一次返工（需求频次） |
| **契合度** | 能否复用现有 `planner / probe / outputPath / ConversionJob` 骨架 |
| **风险** | 是否触碰状态机、是否可能让已通过的 32 组合回归变红 |
| **前台可见度** | 界面上是否已经存在「承诺了但没做」的位置（假承诺优先兑现） |

最后一条是本轮的额外准则：MVP 里凡是界面上写了「待后续迭代」而实际有真实诉求的位置，
优先兑现——否则用户会持续看到同一句说明。

---

## 1. 候选方向与排序

| 序 | 方向 | 对应 BACKLOG | 价值 | 风险 | 本轮结论 |
|---|---|---|---|---|---|
| A | **参数预设真正生效** | P1-03 | 高 | 低 | `已实现` |
| B | **转换历史** | P1-02 | 中高 | 低 | `已实现` |
| C | **批量队列** | P1-01 | 最高 | 中高 | `已实现`（见 §5） |
| D | 字幕 / 多音轨保留 | P1-05 | 中 | 中 | `排队` |
| E | 输出质量校验（SSIM 抽样） | P1-06 | 中 | 中 | `排队` |
| F | 分辨率缩放 / 裁剪 | P1-07 | 中 | 中 | `排队` |
| G | 硬件加速（NVENC / QSV / AMF） | P1-04 | 中低 | 高 | `排队` |
| H | 深色模式 | P2-01 | 低 | 低 | `排队` |
| I | 断点续传 / 失败重试 | P1-08 | 中 | 高 | `排队` |

**为什么 A 在 B 前面**：预设页现在写着「该设置暂未接入转换流程」，属于明确的
假承诺；而实现它只需要把档位传进 `planConversion`，不动状态机、不动文件写出，
风险最低而体验闭环最完整。

**为什么 C 不排第一**：批量队列价值最高，但它必须改 `JobManager` 的调度模型与
转换页的交互（原型只有单任务行），属于「需要先定交互再写代码」的类别。
在交互定清楚之前动手，返工成本远高于先做 A/B。C 的交互规格在 A/B 落地后由产品侧给出
（见 §5），本轮一并实现。

---

## 2. A · 参数预设真正生效 `已实现`

### 范围
- `PresetsPage` 的 8 容器 × 3 档（高清优先 / 标准 / 体积优先）从「只持久化」
  变为**真实影响编码参数**。
- 只影响需要重编码的场景（`transcode` / `remux` 的音频部分）。直通（`copy`）
  不经编码器，预设对它是空操作——这一点要在界面上说清，不能让用户以为
  「选了体积优先但文件没变小」是 bug。
- 不做：精细调节（CRF 数值、双遍、目标体积），仍按原型锁定（P2-03）。

### 输入输出
| 项 | 内容 |
|---|---|
| 输入 | `Settings.presets[target]: 'high' \| 'standard' \| 'small'` |
| 内部 | `buildVideoQualityArgs(encoder, srcBitrate, tier)`、`audioBitrateFor(encoder, tier)` |
| 输出 | `PlanResult.args` 里的 `-crf/-b:v/-b:a` 数值；`PlanResult.preset` 回填档位 |
| IPC | `convert:preview` / `convert:start` 的 payload 新增可选 `preset`，主进程缺省时回落到设置 |

### 档位映射（关键数值）

| 档位 | x264 CRF | 其他 CRF 编码器 | 码率模式（相对源码率） | 音频 |
|---|---|---|---|---|
| high | 18 | 22 | 1.15×（钳 800–8000k） | 256k（opus 160k） |
| standard | 20 | 24 | 0.85× | 192k（opus 128k） |
| small | 26 | 30 | 0.45× | 96k（opus 64k） |

`standard` 的数值与 MVP 完全一致 —— 这是「不破坏已有行为」的硬约束：
升级后未改过预设的用户，产出的参数必须逐字节相同。

### 验收标准
1. `standard` 档位下 `planner` 产出的 args 与 MVP 完全一致（旧单测原样通过，不得改断言）。
2. `high` / `small` 下 CRF 与码率按上表变化，且 `-crf` 与 `-b:v` 仍互斥（VP9 仍带 `-b:v 0`）。
3. 直通场景（h264→mp4）切换任意档位，`args` 不变、不出现 `-crf`。
4. 预设页改动后回到转换页，判定条上的档位提示与实际传给 ffmpeg 的参数一致。
5. 32 组合回归仍 32/32；`standard` 组合的输出体积与 MVP 同量级。

---

## 3. B · 转换历史 `已实现`

### 范围
- 每次转换**成功**后落一条记录；失败与取消不落（避免历史里全是噪音）。
- 队列页「最近记录」区从锁定占位变成真实列表，支持打开所在文件夹、清空历史。
- 不做：失败记录、批量重跑、按格式筛选（等 C 落地后一起做）。

### 输入输出
| 项 | 内容 |
|---|---|
| 输入 | 任务终态 `{result, fileName, sourcePath, target}` |
| 存储 | `userData/history.json`，最多 100 条，FIFO 淘汰；写入走 `.tmp` + rename 原子替换 |
| 输出 | `HistoryEntry[]`（按 `finishedAt` 倒序） |
| IPC | `history:list` → `HistoryEntry[]`；`history:clear` → `{ok}` |

```ts
interface HistoryEntry {
  id: string;              // 复用 jobId，去重与定位都用它
  fileName: string;
  sourcePath: string;
  outputPath: string;
  target: ContainerKey;
  mode: ConversionMode;
  sourceSizeBytes: number;
  outputSizeBytes: number;
  elapsedMs: number;
  verified: boolean;
  finishedAt: number;      // epoch ms
}
```

### 验收标准
1. 转换成功后历史立即多一条，且顺序为最新在前。
2. 记录条数上限 100，超出淘汰最旧的（单测覆盖）。
3. `history.json` 损坏 / 不存在 / 权限异常时，列表返回空且**不抛错**（不能因为历史挂掉转换页）。
4. 同一 jobId 重复写入不产生重复记录（幂等）。
5. 清空后文件被重置为 `[]`，界面回到空态文案。
6. 历史读写不影响 32 组合回归与集成测试（历史模块可在测试里注入临时目录）。

---

## 4. 兼容性约定（A / B / C 共同遵守）

1. **不改默认行为**：`preset` 缺省 = `standard`；历史模块独立于转换链路，写失败只记日志；
   队列默认「共用全局参数」+「失败后继续」，与 MVP 的「选一个文件转一次」体验一致。
2. **不改既有 IPC 语义**：`convert:preview` / `convert:start` 只**新增可选参数**，
   旧调用方（含未来脚本）不传也能工作；`convert:start` 内部改为单条入队，返回值形状不变。
3. **不改原型布局**：新增内容只填充原型已有的空位（预设页提示条、队列页最近记录区），
   不新增页面、不改动既有区块的层级与尺寸。
4. **测试先行**：所有新的纯逻辑（档位映射、历史存取、参数解析）先进 `tests/unit`，
   涉及 ffmpeg 的行为靠现有 `tests/regression` 兜底。
5. **并发固定为 1**：队列只负责排队，不改变「同一时刻一个 ffmpeg」这条 MVP 前提；
   并发数调节留到后续版本（设置页如实标注）。

---

## 5. C · 批量队列 `已实现`

交互规格由产品侧在 A/B 落地后确认（三条），实现严格按规格落地：

### 5.1 三条规格与落点

| 规格 | 实现落点 |
|---|---|
| **文件入队**：点击选择单个文件添加 + 拖拽多个文件批量入队 | 转换页「选择文件 → 开始转换」= 入队 1 条；拖拽（转换页空态 / 队列页）与队列页「添加文件」（多选对话框）走 `addPaths` 批量入队 |
| **参数模式可切换**：共用全局参数（默认）/ 单任务独立参数 | `Settings.queueMode`；`resolveTaskParams` 决定 `custom > 全局` 的优先级；队列卡片用 `chip-custom` / `chip-global` 标出来源 |
| **切换模式只影响后续新增任务** | 模式只在**入队时**读取一次，任务把自己的参数固化在 `custom` 里；切换模式不改已存在任务 |
| **失败策略二选一**（设置页） | `Settings.failurePolicy = 'continue' \| 'pause'`，在**失败那一刻**读取（用户中途改设置也生效） |
| **失败任务标红 + 记日志 + 可重试 / 删除** | `.is-failed` 红卡 + 错误码与原文进 `logger.warn('job failed', …)`；`queue:retry` / `queue:remove` 单独操作 |

### 5.2 范围
- `JobManager` 从「单 current」改为 `entries[] + activeId`，**并发固定为 1**。
- 队列条目携带自己的 `{target, preset, custom, outputPath}`；参数解析只在主进程做一次
  （`ipc/queue.ts` 是唯一解析点），避免前后端各算一套。
- 转换页仍是单任务视图，只认自己那个 `jobId`（队列里有别人的任务时进度不会串）。
- 不做：暂停后自动恢复上一次队列（重启不持久化）、拖拽排序、并发数调节、失败记录进历史。

### 5.3 输入输出
| 项 | 内容 |
|---|---|
| 输入（渲染层） | `EnqueueItemInput[]`：`{ meta, globalTarget?, custom: TaskParams \| null }` + `outputDir` |
| 内部解析 | `resolveTaskParams({ custom, globalTarget, presets })` → `{ target, preset, custom }` |
| 输出 | `QueueSnapshot { items, activeId, paused, pausedReason, mode, policy }` |
| 事件 | `queue:changed`（整份快照）、`job:progress` / `job:state`（带 `jobId`，渲染层按 id 过滤） |
| IPC | `queue:enqueue` / `queue:list` / `queue:update` / `queue:cancel` / `queue:remove` / `queue:retry` / `queue:resume` |

```ts
interface QueueItem {
  jobId: string;
  fileName: string; sourcePath: string; outputPath: string;
  target: ContainerKey; preset: PresetTier;
  custom: TaskParams | null;        // 非空 = 该任务自带参数，优先级高于全局
  status: JobStatus;                // 新增 'pending'（已入队待开始）
  mode: ConversionMode | null;
  sourceSizeBytes: number;
  progress?: ProgressPayload; result?: JobResult; error?: JobError;
  createdAt: number;
}
```

### 5.4 实现要点（四条容易踩的）
1. **入队即预定输出路径**：`reserved: Set<string>`（小写归一化）参与 `resolveOutputPath`
   的存在性判断，否则同一源文件的两个任务会算出同一个文件名，后一个覆盖前一个。
2. **终态处理分流**：`done` / `cancelled` 立刻移出队列（成功结果进历史）；`error`
   **留在队列里**标红，供重试或删除——这也是「失败任务不静默消失」的实现。
3. **暂停解除有三条路径**：手动「继续队列」、删掉最后一条失败任务、对失败任务重试。
4. **jobId 必须唯一贯穿**：`ConversionJob` 由队列传入 `jobId`（而不是自己 `randomUUID`），
   `progress / state / result` 三个事件都用它。这一条是被集成测试抓出来的真实缺陷
   （见 §6「本轮修掉的问题」）。

### 5.5 验收标准
1. 拖入 3 个文件 → 队列 3 条，单并发顺序执行，完成顺序与入队顺序一致。
2. 同一源文件入队两次 → 两个不同的输出路径（第二个自动加序号）。
3. 共用全局模式：条目 `custom === null`，卡片显示「跟随全局」；
   单任务模式：条目带 `custom`，卡片显示「自定义」，可展开编辑器单独改格式与档位。
4. 切换模式后，已入队任务的 `custom` 不变（只有新增任务受影响）。
5. 编辑任务格式 → `target` / `preset` / `outputPath` 扩展名三者同步变化。
6. 策略 A（继续）：一条失败后其余任务照常跑完，失败任务留在队列里。
7. 策略 B（暂停）：一条失败后队列停住（`paused=true, pausedReason='failure'`），
   后续任务保持 `pending`；「继续队列」或删掉失败任务后自动恢复。
8. 失败任务可单独重试（`jobId` 不变、源文件恢复后能真的转完）与单独删除。
9. 失败原因用中文展示，原始 errno 只进日志与「复制诊断信息」。
10. 既有 32 组合回归、MVP 单任务流程、`standard` 档位参数逐字节一致，全部不回归。

### 5.6 追加需求：转换页整批组装与 10 个上限 `已实现`

队列落地后产品侧追加一条：**转换页自己也要能凑一批**，整批统一一个目标格式，
而不是「先入队再逐条改」。规格与落点：

| 规格 | 实现落点 |
|---|---|
| 逐个添加，每加一个后仍能继续加 | `ConvertPage` 常驻一条 `.batch-add` 操作条：「加入下一个视频」（`pickIntoBatch(false)`）；1 个文件时也显示，所以加完第一个就能接着加 |
| 一次性选择多个 | 同一条的「一次选多个」+ 空态拖拽区的「一次选择多个视频…」+ 整窗拖拽，三条入口都走 `addToBatch(paths)` |
| 整批统一同一个目标格式 | 转换页只有一个 `target`；`setTarget` / `chooseOutputDir` 对整批 `Promise.all` 重算 `plan` 与 `outputPath`，扩展名一起变 |
| 单次添加上限 10 | `shared/batch.ts` 的 `limitAdd(items, existing, cap, once)`，`once = MAX_BATCH_ONCE` |
| 待转换总数上限 10 | 同一个 `limitAdd` 的 `cap = MAX_BATCH_TOTAL`，按 `existingCount` 扣掉已选数量 |
| 达上限后禁止继续添加 + 明确提示 | 两个入口按钮 `disabled`、提示条转 `is-full` 强调色文案「已达上限 10 个，不能再添加」；满了再拖文件只弹一次 `limitMessage` |
| 原有单文件流程不受影响 | `batch[0]` 兼职主文件：1 个文件仍渲染 `MediaCard + PlanSummary`、仍在转换页内看进度，`start()` 对 1 个走原路径、≥2 个才整批入队并跳队列页 |

**判定顺序**（这是三种提示文案的由来）：先看总数是否已满 → 再看还能塞几个 →
`take = min(单次上限, 剩余空位)`，`reason` 取「真正把数量压下来的那条约束」。

**范围边界**：不做拖拽排序、不做批次内单条改格式（统一格式是需求本身）、
不做批次模板保存；队列页「添加文件」按单次 10 个截断，但不限制队列总长度。

**验收标准**（`scripts/cdp-batch-check.mjs` 38 条断言逐条覆盖）：
1. 一次选 15 个 → 只进前 10 个，提示「一次最多添加 10 个视频，这次只加入前 10 个」。
2. 已有 2 个再选 13 个 → 总数卡在 10，提示「最多同时转换 10 个视频，这次加入了 8 个（已有 2 个）」。
3. 满 10 个 → 两个入口按钮 `disabled`，提示条为「已达上限 10 个，不能再添加」且用强调色。
4. 满 10 个再拖文件 → 数量不变，只弹「请先转换或移除部分文件再加」。
5. 1 个文件时视图与按钮文案与 MVP 完全一致；2 个起切批次列表 + 汇总条。
6. 切换目标格式 → 整批输出扩展名一起变（mp4 → mkv），汇总条同步。
7. 移除其中一条 → 入口按钮恢复可用，能继续添加。
8. 整批开始 → 批次清空回空态、跳任务队列页、提示「已加入队列：N 个视频」。
9. 单文件流程回归：仍在转换页内完成、`verified: true`、产物大小与 MVP 一致。
10. `limitAdd / remainingSlots / limitMessage` 的边界（0 / 刚好 10 / NaN / 负数）全部单测覆盖。

---

## 6. 本轮实现清单

### A · 参数预设
- [x] `containers.ts`：档位映射表 + `buildVideoQualityArgs/audioBitrateFor` 增加 `tier`
- [x] `planner.ts`：`options.preset` 贯通，`PlanResult.preset` 回填
- [x] IPC / preload：`preview` / `start` 支持 `preset`
- [x] 渲染层：预设改动后即时重算判定；预设置为 `standard` 以外的档位时，判定条补充一行说明
- [x] 预设页：去掉「暂未接入」提示，改为「立即生效」+ 直通场景说明

### B · 转换历史
- [x] 历史：`core/job/history.ts`（可注入路径、可单测）+ `main/history.ts` 单例 + IPC
- [x] 队列页：最近记录真实列表 + 清空

### C · 批量队列
- [x] `shared/queue.ts`：参数解析与状态判定（纯函数，主进程与渲染进程共用）
- [x] `shared/types.ts`：`QueueItem / QueueSnapshot / EnqueueItemInput / TaskParams`、`JobStatus` 新增 `pending`
- [x] `core/job/JobManager.ts`：队列 + 输出路径预定 + 编辑 / 重试 / 移除 / 继续 + 失败暂停
- [x] `ipc/queue.ts`：唯一参数解析点 + 事件转发 + 失败日志
- [x] `ipc/convert.ts`：`convert:start` 改为单条入队，链路只留一条
- [x] `selectVideo` 支持多选（队列页「添加文件」）
- [x] 渲染层：`myJobId` 过滤、`addPaths` 分流（1 个走选择格式 / 多个直接入队）、`pickFiles`
- [x] 队列页：排队 / 运行 / 失败三种行、参数来源标签、内联编辑器、暂停提示条
- [x] 设置页：输出参数模式 + 失败策略两个分段控件
- [x] `toAppError`：原生 errno → 中文文案（失败卡片不再出现 `EEXIST: ...`）

### C 追加 · 转换页整批组装
- [x] `shared/batch.ts`：`MAX_BATCH_TOTAL` / `MAX_BATCH_ONCE` / `remainingSlots` / `limitAdd` / `limitMessage`
- [x] `useAppStore`：`batch: BatchEntry[]` + `pickIntoBatch` / `addToBatch` / `removeBatchItem`；`setTarget` / `chooseOutputDir` 改为整批重算
- [x] `ConvertPage`：常驻「加入下一个视频 / 一次选多个 / `已选 N/10 个`」操作条，满额禁用并转强调色
- [x] `BatchList.tsx`：≥2 个文件时的批次列表（序号 / 文件名 / 体积时长 / 判定标签 / 移除）与批量汇总条
- [x] `DropZone`：空态增加「一次选择多个视频…」入口；`useFileDrop` 按当前页面分流到 `addToBatch` / `enqueuePaths`
- [x] `start()` 双出口：1 个留在转换页走原流程，≥2 个整批入队并跳队列页

### 测试与验证
- [x] 单测：档位映射、planner 档位、历史存取、`resolveTaskParams` 优先级、`toAppError` 翻译、批次数量规则（17 例）
- [x] 集成：`tests/integration/queue.test.ts`（FIFO、路径预定、两种失败策略、重试、单任务编辑）
- [x] 文档：README 能力表 / BACKLOG 状态 / 本文件
- [x] 界面验证：`scripts/cdp-queue-check.mjs`（24 条断言 + 4 张截图，真实转码驱动）
- [x] 界面验证：`scripts/cdp-batch-check.mjs`（38 条断言 + 4 张截图，15 个真实视频副本驱动）

### 本轮修掉的问题

| 问题 | 表现 | 根因 | 修法 |
|---|---|---|---|
| jobId 双份 | 转换页进度条不动、终态被当成别人的任务忽略 | `ConversionJob` 自己 `randomUUID()`，与队列条目 id 不同 | 队列把自己的 `jobId` 传进构造参数，事件统一用它 |
| errno 外泄 | 失败卡片显示 `EEXIST: file already exists, mkdir 'C:\…'` | `toAppError` 用原生 `err.message` 当用户文案 | 增加 errno → `ErrorCode` 映射，原文转存 `detail` |
| 历史偶发写失败 | 高并发下 `rename` 抛 EPERM/EBUSY，该条历史丢失 | Windows 杀软 / 索引服务短暂占用目标文件 | 原子写加重试（最多 3 次退避），仍失败才记警告 |
| 侧边栏「迭代」徽标 | 队列页明明已经实现，导航仍写着「迭代」 | 原型遗留标记 | 去掉徽标；拖拽区文案「一次一个文件」同步改为可多选 |
| 批次列表最后一行被切一半 | 满 10 个时第 10 行只露出上边缘 | 列表给了 `max-height: 268px` 的内滚动，装不下 10 行 | 去掉内滚动（上限只有 10 行），让列表跟随页面一起滚 |
