# 视频转换器 · MVP 开发计划

> **编制日期**：2026-07-04
> **依据**：《需求分析文档》v1.0（M-01~M-06）、《方案设计文档》v1.0、`prototype/index.html`
> **状态**：§7 三项冲突**已确认**（2026-07-04），待整体计划批准后从 Step 0 开始编码
> **承诺**：本计划不含任何推测性技术方案，所有版本号均已用 `npm view` 实测核对，所有未确认项都列在 §7

---

## 0. 一句话结论

**能做完。1 个环境前置已确认由我处理，3 处文档/原型冲突已拍板。**

| 项 | 状态 |
|---|---|
| 技术栈可行性 | ✅ 已实测：全部依赖在 npm 上存在，版本与文档一致 |
| 工程环境 | ✅ Node 22.22.2 / npm 10.9.7 / pnpm 12.14.0 可用，npm 源连通 |
| **FFmpeg 二进制** | ⚠️ 本机未安装、`resources/` 为空 → **已确认：Step 1 由我 winget 安装并归档**，见 §7-Q1 |
| 文档 vs 原型冲突 | ✅ **3 处已拍板**，见 §7；由此带来 2 处范围调整（页面分级实现、新增轻量校验） |
| 预估工作量 | 8 个 Step，代码约 3600~4100 行（含测试） |

---

## 1. 范围界定

### 1.1 本次要做（对齐 M-01 ~ M-06）

| 需求 | 内容 | 落点 |
|---|---|---|
| M-01 | 文件导入（全窗口拖拽 + 对话框 + 单文件替换） | `preload` 的 `webUtils.getPathForFile` + `DropZone.tsx` |
| M-02 | 元数据解析 + 缩略图（含降级链） | `core/ffmpeg/probe.ts` + `ipc/media.ts` + `MediaCard.tsx` |
| M-03 | 8 容器 + 智能直通判定 | `core/ffmpeg/containers.ts` + `planner.ts` + `TargetPicker` / `PlanSummary` |
| M-04 | 转码执行 · 进度 · 取消 | `core/ffmpeg/runner.ts` + `core/job/*` + `ProgressPanel.tsx` |
| M-05 | `.part` 落盘 · 原子重命名 · 防覆盖 | `core/fs/outputPath.ts` + `temp.ts` + `ResultCard.tsx` |
| M-06 | 错误翻译（7 类规则）+ 诊断复制 | `core/ffmpeg/errors.ts` + `ErrorPanel.tsx` |

### 1.2 本次明确不做（按文档标记，代码里会加 `// [P1-xx]` 注释占位）

| 编号 | 功能 | 依据 |
|---|---|---|
| P1-01 | 分辨率缩放 | 需求 §2.3 |
| P1-02 | 视频转音频 | 需求 §2.3 |
| P1-03 | 硬件加速（NVENC/QSV/AMF） | 需求 §2.3 |
| P1-04 | 平台预设卡片（抖音/B站） | 需求 §2.3 |
| P1-05 | 批量队列 / 文件夹导入 | 需求 §2.3 |
| P1-06 | 输出校验（SSIM/抽样解码） | 需求 §2.3。**轻量版（ffprobe 读回比对时长+流数量）已确认提前到 MVP**，见 §7-Q3；SSIM/抽样解码仍不做 |
| P1-07 | 右键菜单 / `videoconv://` / 系统通知 | 需求 §2.3 |
| P2/P3 | Two-Pass、横转竖、字幕策略、自动更新、付费 | 需求 §3.3 / §3.4 |

**代码层面的"标记"约定**：每个未实现能力在对应位置留一行 `// [P1-05] 批量队列：MVP 不实现，入口置灰`，并同步写进 `docs/BACKLOG.md`（Step 8 产出）。

### 1.3 原型中不进入真实应用的部分

| 原型元素 | 处理 | 理由 |
|---|---|---|
| 顶部「原型预览尺寸」工具条 | **删除** | 原型自带的演示工具，非产品功能 |
| 空态下方「试试示例：旅行记录.mkv / 会议录屏.mp4 / 损坏片段.mp4」 | **删除** | 演示数据，真实应用必须读用户真实文件 |
| 标题栏三键（─ □ ×） | 保留外观，接 `minimize/maximize/close` | 原型是死的，真实应用要能点 |

---

## 2. 技术栈与版本核对（全部实测）

| 包 | 文档锁定 | npm 实测 | 结论 |
|---|---|---|---|
| electron | 44.9.0 | 44.9.0 | ✅ 一致 |
| vite + vite-plugin-electron | 8.3.4 / 1.1.2 | 8.3.4 / 1.1.2 | ✅ 一致（**构建器已由 `electron-vite` 改为 create-electron-vite 脚手架方案**，见 §0 修订） |
| electron-builder | 26.15.3 | 26.15.3 | ✅ 一致 |
| react / react-dom | 19.3.1 | 19.3.1 | ✅ 一致 |
| **typescript** | **5.9.3** | **latest = 7.0.2** | ⚠️ **必须显式 `typescript@5.9.3`**，不能用 `^` 或 `latest` |
| zustand | 5.0.15 | 5.0.15 | ✅ 一致 |
| electron-store | 12.0.0 | 12.0.0 | ✅ 一致 |
| tailwindcss / @tailwindcss/vite | 4.3.3 | 4.3.3 | ✅ 一致 |
| @vitejs/plugin-react | — | 6.1.2 | ✅ 文档未锁，取当前版本 |
| vitest | 5.0.5 | 5.0.5 | ✅ 一致 |
| FFmpeg | 8.1.3 GPL full | — | ❌ 本机未安装（见 §7-Q1） |

> `package.json` 里全部用**精确版本号**（不带 `^`），避免 `pnpm install` 时被浮动版本带偏。文档明确要求版本锁定，这是其中之一。

---

## 3. 目录结构（严格对齐方案 §5）

```
VideoTranscoder/
├── vite.config.ts               # vite + vite-plugin-electron（脚手架生成后改造）
├── electron-builder.json5
├── package.json                 # "main": "dist-electron/main.cjs"
├── pnpm-workspace.yaml          # allowBuilds + nodeLinker: hoisted（pnpm 12 必需）
├── tsconfig.json / tsconfig.node.json
├── .eslintrc.cjs
├── vitest.config.ts             # 待 Step 0 建
├── scripts/
│   ├── check-env.ps1            # 已有
│   ├── make-fixtures.ps1        # 已有（需按 ffmpeg 路径改造）
│   ├── fetch-ffmpeg.ps1         # 新增：拉取/复制 GPL full 二进制到 resources/
│   └── regression.ts            # 新增：56 组合回归
├── resources/
│   └── bin/win32-x64/
│       ├── ffmpeg.exe
│       ├── ffprobe.exe
│       └── VERSION.txt
├── tests/
│   ├── fixtures/                # make-fixtures 生成，不进仓库
│   ├── unit/
│   │   ├── planner.test.ts      # ★ TDD
│   │   ├── containers.test.ts
│   │   ├── errors.test.ts
│   │   └── outputPath.test.ts
│   └── integration/
│       ├── probe.test.ts        # 真实 ffprobe
│       └── runner.test.ts       # 真实 ffmpeg
└── src/
    ├── shared/                  # 主/渲染共用，禁止出现 node:* 与 electron 运行时 API
    │   ├── types.ts
    │   ├── containers.ts
    │   └── errors.ts
    ├── main/
    │   ├── index.ts
    │   ├── store.ts
    │   ├── logger.ts
    │   ├── ipc/{index,media,convert,shell,app}.ts
    │   └── core/
    │       ├── ffmpeg/{paths,probe,planner,runner,errors}.ts
    │       ├── job/{ConversionJob,JobManager}.ts
    │       └── fs/{outputPath,temp}.ts
    ├── preload/{index.ts,index.d.ts}
    └── renderer/
        ├── index.html
        └── src/
            ├── main.tsx / App.tsx
            ├── components/{ui,DropZone,MediaCard,TargetPicker,PlanSummary,ProgressPanel,ResultCard,ErrorPanel,Toast,AppShell}.tsx
            ├── pages/{ConvertPage,QueuePage,PresetsPage,SettingsPage,AboutPage}.tsx
            ├── store/useAppStore.ts
            ├── lib/api.ts
            └── styles/main.css
```

**两条纪律（会当成 lint 规则守）**
1. `src/shared/**` 不得 import `node:*` 或 `electron`——它要被打进渲染进程。
2. `planner.ts` 不得 import 任何 `electron` / `node:fs`——这是它能被单测和迁移的前提。

> ⚠️ 与 `.gitignore` 的联动：`resources/bin/`、`tests/fixtures/` 已在忽略列表里。这意味着**新克隆的仓库没有 ffmpeg**，必须跑 `scripts/fetch-ffmpeg.ps1`。这是刻意的（80MB×2 二进制不进 Git），会在 README 和启动自检里明确提示。

---

## 4. 分步开发计划

每个 Step 结束都有可验证的产出，**不写"看起来对"的代码**。

### Step 0 · 工程骨架（产出：能打开的空白窗口）

| 项 | 内容 |
|---|---|
| 做什么 | 用 `create-electron-vite@0.7.1` 生成骨架（临时目录生成后拷回，避免清空项目根）→ 删 demo → `vite.config.ts` 改造 → `vitest.config.ts` → 最小可运行的 main/preload/renderer |
| 关键点 | main 窗口参数按方案 §4.2：1080×720 / min 860×600 / `contextIsolation:true` / `nodeIntegration:false` / `sandbox:true`；单实例锁；`backgroundThrottling:false`（转码时窗口失焦不降频）；**main 与 preload 都必须产出 CJS**（`.cjs`），否则分别报 `does not provide an export named 'BrowserWindow'` 与沙箱 preload 加载失败 |
| 验收 | `pnpm dev` 弹出窗口无报错；`pnpm typecheck` 零错误；`pnpm build` 通过 |
| 风险 | electron 二进制从 GitHub 下载可能慢/失败 → 预案：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` |

### Step 1 · 二进制路径与启动自检（产出：能找到 ffmpeg 并在缺失时给出引导）

| 项 | 内容 |
|---|---|
| 做什么 | `paths.ts`（开发态 `<root>/resources/bin/win32-x64/`、打包态 `<install>/resources/bin/`）+ `verifyBinaries()` + `app:capabilities` 通道 + 缺失时的引导页 |
| 关键点 | 自检跑 `ffmpeg -version` 拿版本号，**并检查 `-encoders` 是否含 `libx264`**（LGPL 精简版会缺，这是最高频的翻车点）；结果缓存，不每次启动都跑 |
| 验收 | 手动把 `ffmpeg.exe` 改名为 `ffmpeg.exe.bak`，应用启动后进入引导态并提示「缺少转换组件」，不崩溃不白屏 |
| 依赖 | FFmpeg 二进制（§7-Q1） |

### Step 2 · ffprobe 链路（产出：正确的 `MediaMeta`）

| 项 | 内容 |
|---|---|
| 做什么 | `probe.ts`：`execFile(ffprobe, [...])` → 解析 JSON → 归一化 `MediaMeta`；`ipc/media.ts` 的 `media:probe` 与 `media:thumbnail` |
| 必须处理的坑 | ① `format_name` 是逗号多值，用 `.includes()` 不能 `===`；② `r_frame_rate` 是分数 `30000/1001`，解析为 29.97；③ `bit_rate` 缺失时按方案 §3.3 的两级兜底；④ VFR 判定阈值 1%；⑤ 无视频流返回 `video:null` 而非抛错 |
| 缩略图 | `-ss 2` 必须在 `-i` **之前**；`-frames:v 1 -vf scale=320:-2 -q:v 3`；失败降级 `-ss 0` → 返回 `null`；MVP 用 base64 dataURL（方案 §4.4 选 B） |
| 验收 | 集成测试对 8 种 fixture 跑一遍，断言时长误差 <0.1s、分辨率/编码/帧率正确、无 `NaN`、无 `null` 崩溃 |
| 依赖 | FFmpeg + fixtures |

### Step 3 · 规划器（**TDD，本项目的核心**）

严格按 TDD 顺序：**先写测试（红）→ 再写实现（绿）→ 重构**。

| 阶段 | 产出 |
|---|---|
| 3.1 | `shared/containers.ts`（8 容器矩阵，逐字按方案 §3.4）+ `containers.test.ts`（矩阵自洽性：`defaultVideo` 必须在该容器 `videoCodecs` 的白名单里，`defaultAudio` 同理） |
| 3.2 | `tests/unit/planner.test.ts` **先写，全部失败** |
| 3.3 | `shared/errors.ts`（`AppError` + 17 个 ErrorCode 枚举） |
| 3.4 | `main/core/ffmpeg/planner.ts` 实现，跑到测试全绿 |

**测试用例清单（约 60 例）**

| 组 | 数量 | 断言重点 |
|---|---|---|
| 矩阵遍历 `8 目标 × 5 源编码` | 40 | `videoAction==='copy'` 时，源编码必须在该目标白名单内（**这条断言是防"判定错"的总闸**） |
| 定点断言 | 8 | MKV(H264+AAC)→MP4=copy；MKV(H264+DTS)→MP4=remux；AVI(mpeg4)→MP4=copy 且带"编码较老"警告；WMV→MP4=transcode；无音频时不出现 `-c:a`；纯音频输入抛 `E_NO_VIDEO_STREAM`；非法 target 抛 `E_UNSUPPORTED_TARGET`；字幕轨在多目标下产生 `SUBTITLE_DROPPED` |
| args 结构 | 6 | ①`0:a:0?` 的问号必须在；②MP4/MOV 才有 `-movflags +faststart`；③WebM 的 `libvpx-vp9` 必须配 `-b:v 0`；④码率模式编码器不得出现 `-crf`；⑤CRF 模式不得出现 `-b:v`（VP9 例外）；⑥args 里不得含绝对路径（那是 runner 的职责） |
| 纯函数性 | 1 | 连调两次同一入参，`deepEqual` 结果（防引入时间戳/随机数） |

**验收**：`pnpm test tests/unit/planner.test.ts` → 60 passed，覆盖率 ≥90%。

### Step 4 · 执行器与任务管理（产出：命令行版能跑通的转换器）

| 项 | 内容 |
|---|---|
| 做什么 | `runner.ts`（spawn + `-progress pipe:1` 解析 + 500ms 节流 + 90s 看门狗）、`ConversionJob.ts`（状态机 + `.part` + rename + `finally` 清理）、`JobManager.ts`（单任务 + `before-quit` 杀进程） |
| 关键点 | ①`spawn(exe, argsArray, {shell:false, windowsHide:true})` 零字符串拼接；②`out_time_us` 优先、`out_time_ms` 兜底（**单位都是微秒**）；③`pct` 封顶 99，只有 `progress=end` 或退出码 0 才置 100；④取消用 `execFile('taskkill', ['/PID', pid, '/T', '/F'])`；⑤`rename` 成功后才置 `done`；⑥`.part` 二次清理延迟 500ms |
| 验收 | `tests/integration/runner.test.ts`：真实 ffmpeg 转一个 3 秒 fixture，断言进度单调递增、终值 100、输出文件可被 ffprobe 读回；取消测试断言 1 秒内进程消失且无 `.part` 残留 |
| 依赖 | FFmpeg |

### Step 5 · IPC 与 Preload（产出：渲染层能安全调用全部能力）

| 项 | 内容 |
|---|---|
| 做什么 | 9 个 `invoke` 通道 + 2 个 `send` 事件，全部用 `IpcResult<T>` 包装；preload 只暴露函数并返回取消订阅函数 |
| 关键点 | ①通道名集中常量，禁止散落字符串；②每个 handler 入参做运行时校验（`path` 必须是 string 且绝对路径）；③`convert:start` 在 `running` 时返回 `E_BUSY`；④**`webUtils.getPathForFile` 放在 preload**（Electron 32+ 必需，`File.path` 已移除） |
| 验收 | 渲染层 `window.api` 类型完整（`index.d.ts`），`tsc` 能校验调用参数；手动删掉 preload 里一个通道，渲染层调用时得到 `ok:false` 而非崩溃 |

### Step 6 · UI 全量（严格按原型，逐元素对照）

**统一用 Tailwind 4 + 自建 shadcn 同构组件**（`components/ui/` 下 `cva` + `cn` 写法）。**不跑 `shadcn` CLI**：它需要交互式确认和网络拉取，会把可复现的构建变成一次性操作；手写同构组件换来的是"能提交、能复现、后续可无痛替换成 CLI 版"。

**原型元素对照表（逐条实现，不允许自行改动）**

| 原型元素 | 组件 | 数据来源 |
|---|---|---|
| 1080×720 窗口 / 40px 标题栏 / 200px 侧边栏 | `AppShell` | 窗口参数 |
| 侧边栏 5 项 + 「迭代」徽标 + 选中竖条 | `AppShell` | 路由状态 |
| 空态拖拽区 320px + 3 条能力说明条 | `DropZone` | 静态文案（**第 3 条文案待确认，见 §7-Q3**） |
| 文件卡：160×90 缩略图 + 三行信息 + 「更换」 | `MediaCard` | `MediaMeta` |
| 8 个格式卡（4×2，名称 + 场景说明） | `TargetPicker` | `CONTAINERS` |
| 判定条 4 态（绿/琥珀/橙/红，左侧 3px 色条 + 图标 + 主副文案） | `PlanSummary` | `PlanResult` + `warnings` |
| 输出位置行（等宽路径 + 「更改」） | `ConvertPage` | `outputPath` |
| 「开始转换」主按钮 40px / 右对齐 | `ConvertPage` | — |
| 转换中卡（进度条 / 百分比 / 已用·剩余 / 取消） | `ProgressPanel` | `ProgressPayload` |
| 直通模式的 **indeterminate** 进度条 | `ProgressPanel` | `mode==='copy'` |
| 完成卡（40px 成功图标 / 体积对比 / 耗时 / 双按钮） | `ResultCard` | `JobResult` |
| 失败卡（左侧红条 / 原因 + 建议 / 两个按钮） | `ErrorPanel` | `AppError` |
| Toast（底部居中 / 最多 3 条 / success 2200ms、error 4000ms） | `Toast` | 全局事件 |
| 任务队列页（进行中任务 + 历史区 `pointer-events:none` + 【待后续迭代】） | `QueuePage` | `JobSnapshot` |
| 关于页 | `AboutPage` | `app:capabilities`（版本从 ffmpeg `-version` 动态读） |
| 参数预设页（8 组 × 3 档） | `PresetsPage` | `electron-store`，**不参与转换**；顶部加「暂未接入转换流程」提示条 |
| 设置页（常规 / 外观 / 性能） | `SettingsPage` | 前 3 项接 `electron-store` 真实生效；主题/性能区按原型置灰 |

**必须原样保住的交互细节**（这些是原型的灵魂，改一个就算没对齐）
- 拖拽：边框转主色 + 底色 `primary-50` + 图标上移 4px；
- 格式卡 hover **不上移**，只换边框 + `shadow-sm`；
- 侧边栏切换**不做整页转场**，只内容区 150ms 淡入；
- 切换格式时判定条**不播高度动画**，只交叉淡入（防抖动）；
- 进度条宽度用 `300ms linear`（唯一非 ease-out 的过渡）；
- 取消按钮**不用红色**（取消是正常操作）；
- 失败态**不提供"重试"**，只有「复制诊断信息」和「换个格式试试」。

**验收**：1080×720 与 860×600 两个尺寸下主按钮完整可见、无横向溢出；拖 `.txt` 走中文提示。

### Step 7 · 输出校验 · 异常与收尾（产出：7 类错误全出中文 + 校验徽章）

| 项 | 内容 |
|---|---|
| 做什么 | ①`errors.ts` 7 条规则 + 兜底（末 20 行）+ 诊断信息拼装 + `.part` 兜底清理；②**`verify.ts` 轻量校验**（见 §7-Q3），接入 `ConversionJob` 的 `rename` 之后、置 `done` 之前 |
| 顺序约束 | **校验必须在 rename 之后执行**：先确认输出是完整文件，再决定置 `done` 还是回滚删文件。顺序反了会出现"文件被删但状态是完成" |
| 验收 | ①单测喂 7 段真实 stderr 片段，断言 code 与中文；②校验用例：人为截断输出文件 → 断言 `verified:false` 且文件被删除；③真实场景：`.txt` 改名 `.mp4`、输出到 `C:\Windows\System32`、转码中占用目标文件 |

### Step 8 · 打包与回归（产出：安装包 + 56 组合报告）

| 项 | 内容 |
|---|---|
| 做什么 | `electron-builder.yml`（`asarUnpack: resources/bin/**` + `extraResources`）+ `scripts/regression.ts` + `docs/BACKLOG.md` + README |
| 验收 | ①`pnpm build && pnpm dist` 出 NSIS 安装包；②解包后确认 `resources/bin/ffmpeg.exe` 真实存在于 `app.asar` 之外；③56 组合回归脚本跑出报告（**干净机测试需你在真机执行，我无法代跑**） |

---

## 5. 测试策略

| 层 | 文件 | 手段 | 何时跑 |
|---|---|---|---|
| **纯函数（TDD）** | `planner` / `containers` / `errors` / `outputPath` | Vitest 单测，**不 Mock ffmpeg**（它们本来就不碰外部） | 每次改动 |
| **集成** | `probe` / `runner` | 真实 ffmpeg 跑真实 fixture | `pnpm test:int` |
| **回归** | `scripts/regression.ts` | 8×7=56 组合真实转换 + ffprobe 读回 | 交付前一次 |
| UI | — | 手工验收清单（方案 §7.1 明确不写 UI 测） | 每个 Step |

**测试环境隔离**：集成测试若检测不到 `resources/bin/win32-x64/ffmpeg.exe`，**直接 `test.skip` 并打印醒目警告**，而不是假装通过。这是"没跑过就说没跑过"的底线。

---

## 6. 风险与对策

| # | 风险 | 概率 | 对策 |
|---|---|---|---|
| 1 | electron 二进制下载失败（GitHub 慢） | 中 | 设 `ELECTRON_MIRROR` 走 npmmirror，失败则改用手动放置 |
| 2 | `sandbox:true` 下 preload 里 `webUtils` 不可用 | 低 | Step 0 就验证一次；不可用则退到 `sandbox:false` + `contextIsolation:true`（安全等价，需记录 ADR） |
| 3 | WMV/MPEG 容器编码失败 | 中 | 这两个容器单独一组用例，失败则降级为"该组合不支持"并在 UI 明确提示 |
| 4 | WebM/VP9 软编极慢 | 高 | 判定条对 WebM 追加"该格式编码较慢"警告（复用 `PlanWarning`） |
| 5 | 中文/空格/括号路径 | 中 | 全程参数数组 + `shell:false`，Step 2 就做三个刻意命名的 fixture |
| 6 | `asarUnpack` 漏配导致打包后 ENOENT | 高 | Step 8 强制验证 `app.asar` 外的 exe 存在 |
| 7 | 56 组合里有几个跑不通 | 高 | 集中回归，逐个修；实在不行降级提示 |

---

## 7. 已确认的 3 个决策（2026-07-04 拍板）

> 原本这里是三个阻塞项，现已全部确认。下面保留"选了什么 / 放弃了什么 / 对计划的影响"，避免以后重复讨论。

### Q1 · FFmpeg 二进制 → **选 A：由我安装并归档到仓库外的 `resources/bin/`**

| 项 | 内容 |
|---|---|
| 做法 | `winget install Gyan.FFmpeg` → 校验 `ffmpeg -encoders` 含 `libx264`/`libx265` → 拷 `ffmpeg.exe`/`ffprobe.exe` 到 `resources/bin/win32-x64/` → 写 `VERSION.txt` |
| 为何不用 npm 的 `ffmpeg-static` | 那是 LGPL 精简版，缺 libx264/libx265，转 H.264 直接 `Unknown encoder`，与文档的 GPL full 基线冲突 |
| 对计划的影响 | Step 1 增加「安装 + 校验 + 归档」三个子任务；Step 2/4/8 的集成测试与 56 组合回归**可以真实执行**，交付物带真实转码证据 |
| 额外动作 | 补 `scripts/fetch-ffmpeg.ps1`，让换机器的人能一条命令复现环境（二进制不进 Git） |

### Q2 · 页面范围 → **选 B：守 MVP 边界，5 页都要有，但只有 2 页有真实能力**

| 页面 | 实现程度 | 数据来源 |
|---|---|---|
| 转换页 | ✅ 完整（M-01~M-06 全链路） | 主进程 |
| 关于页 | ✅ 完整（版本号从 ffmpeg `-version` 动态读，GPL 声明） | `app:capabilities` |
| 任务队列页 | ✅ 真实（展示当前任务 / 进度 / 取消），历史区按原型置灰 + 【待后续迭代】 | `JobSnapshot` |
| **参数预设页** | ⚠️ **1:1 还原原型外观，三档可选但只写本地状态，不接 planner** | `electron-store` 持久化，不参与转换 |
| **设置页** | ⚠️ **1:1 还原原型外观**，但「默认保存位置 / 默认输出格式 / 完成后打开文件夹」三项**真实生效**；主题与密度照原型（深色禁用、密度可用） | `electron-store` |

> **两页的"未生效"如何诚实表达**：参数预设页与设置页中不参与转换的区块，顶部加一条原型里没有的灰底提示条——`该设置暂未接入转换流程，将在 P1 版本生效`。这是本次唯一的新增 UI 元素，属于范围决策的必要补充，不是自行改动布局。

**放弃的方案**：A（三档真实驱动 CRF 17/20/25）——会让 planner 从"一个决策点"变成两个，与 ADR-005 冲突，且需要额外维护「三档 × 8 容器」的映射表。

### Q3 · 输出校验 → **选 A：实现轻量校验，让首页文案不撒谎**

| 项 | 内容 |
|---|---|
| 新增模块 | `src/main/core/ffmpeg/verify.ts`，导出 `verifyOutput(srcMeta, outPath, expectedMode)` |
| 校验内容 | ①输出文件存在且大小 > 0；②ffprobe 读回时长与源差异 <0.2s；③视频流存在且数量一致；④音频流数量符合预期（源有声则输出也有声） |
| 失败处理 | 校验不通过 → 视为任务失败，走 `E_OUTPUT_INVALID`，**删除已 rename 的文件**（否则用户拿到一个坏文件还以为成功了） |
| 对类型的影响 | `JobResult` 增加 `verified: boolean` 与 `verifyDetail?: string` |
| UI 影响 | 完成卡增加一行 `✓ 已验证可播放`（绿）/ `⚠ 已完成，但校验未通过`（琥珀），**不新增卡片、不改布局** |
| 边界 | 只做容器层校验，**不做**解码抽样与 SSIM（那是 P1-06 的完整形态） |

---

## 8. 已按文档直接定下、不再问的 4 个细节

| 项 | 决定 | 依据 |
|---|---|---|
| 默认输出目录 | **源文件同级**（不是原型里写的 `C:\Users\Public\Videos`） | 需求 M-05 明确；原型那行是演示数据，UI 结构不变，只换真实路径 |
| 判定条文案 | 用**原型**口径（`无损直通 · 无需重新压缩` / `混合直通 · 画面不动，音频需要转换` / `需要重新压缩 · 耗时更长`），不用方案 §3.10 的旧版 | 你要求 UI 以原型为准 |
| 「检查更新」按钮 | 保留外观，点击提示「当前为开发版本，暂无更新通道」 | 自动更新是 P3-03 |
| 主题深色 / 跟随系统 | 保持禁用态（原型已是 disabled），Token 预埋 | 原型现状 + 需求 §2.3 |

---

## 9. 交付物清单

| # | 交付物 | 验收方式 |
|---|---|---|
| 1 | 可运行工程（`pnpm dev` 起得来） | 我实跑截图 |
| 2 | `planner` 单元测试 ≥60 例全绿 | `pnpm test` 输出 |
| 3 | 集成测试（probe / runner）跑真实 ffmpeg | `pnpm test:int` 输出 |
| 4 | 56 组合回归报告 `docs/regression-report.md` | 真实执行结果（含失败项说明） |
| 5 | NSIS 安装包 | `pnpm dist` 产物路径 |
| 6 | README（环境准备 + fetch-ffmpeg + 开发命令） | 文档 |
| 7 | `docs/BACKLOG.md`（P1/P2 标记清单） | 文档 |

---

## 10. 执行顺序与检查点

```
Step 0  骨架            → 检查点①：pnpm dev 能开窗口
Step 1  路径+自检       → 检查点②：删掉 ffmpeg 能进引导态
Step 2  probe           → 检查点③：8 种 fixture 的 MediaMeta 全对
Step 3  planner (TDD)   → 检查点④：60 例单测全绿   ★最关键
Step 4  runner+Job      → 检查点⑤：命令行完成一次真实转码并带进度   ★★最关键
Step 5  IPC+preload     → 检查点⑥：渲染层能拿到真实数据
Step 6  UI              → 检查点⑦：端到端跑通一次，两个尺寸不破
Step 7  校验+异常        → 检查点⑧：7 类错误全出中文 + 校验徽章正确
Step 8  打包+回归       → 检查点⑨：安装包 + 56 组合报告
```

**检查点④和⑤我会停下来让你实跑验证**——这两个点如果不对，后面全是白做。

---

## 11. 这次不写代码的原因

你的要求是「先出计划、人工确认通过后再编码」。§7 的三个决策已经落定，计划主体（范围、目录、9 个 Step、测试策略）还没被否过。**在你回复"计划通过"之前，我不会创建任何工程文件**——避免方向错了再返工，这是我上次在"无损直通体积"上得到的最好教训。

---

**计划结束。§7 三项已确认；计划主体如无异议，回一句"通过"我从 Step 0 开始。**
