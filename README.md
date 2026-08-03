# 视频转换器（Video Converter Desktop）

[![CI](https://github.com/Zkaixin111/video-converter-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/Zkaixin111/video-converter-desktop/actions/workflows/ci.yml)

本地视频格式转换桌面客户端。拖入一个或多个视频，选一个目标格式，应用负责两件事：
**让它一定能用**，以及**告诉你为什么之前不行**。

- Electron 44 + React 19 + TypeScript 5.9 + Vite 8 + Tailwind 4
- 转码引擎 FFmpeg（GPL，随包分发，全程离线）
- Windows 桌面端，无服务端、无账号、无上传

---

## 1. 现在能做什么（MVP + P1）

| 能力 | 说明 |
|---|---|
| 8 种目标格式 | MP4 / MKV / AVI / MOV / FLV / WMV / WebM / MPEG |
| 智能直通 | 源编码能被目标容器接受时**不重新压缩**，只换封装，秒级完成且画质零损失 |
| 混合直通 | 画面能直通、音频装不下时，只重编码音频 |
| 全量重编码 | 编码不兼容时完整转码，自动选对编码器与质量参数 |
| 实时进度 | `-progress` 解析出百分比、速度、剩余时间；直通模式用不定长进度条 |
| 取消与清理 | 随时取消，Windows 下按进程树 kill，`.part` 临时文件不残留 |
| 转完自动校验 | ffprobe 读回输出，校验时长/视频流/音轨；不通过就删掉坏文件并报错 |
| 中文错误 | 7 类 ffmpeg 报错翻译成人话 + 下一步建议，技术细节只进「复制诊断信息」 |
| 拖拽导入 | 整个窗口都是投放区；非视频文件在渲染层就拦下并提示 |
| 设置持久化 | 默认保存位置 / 默认格式 / 完成后打开文件夹 / 界面密度（electron-store） |
| **画质档位真实生效**（P1） | 参数预设页的 8 容器 × 3 档直接决定 CRF / 目标码率 / 音频码率；`standard` 与 MVP 参数逐字节一致 |
| **转换历史**（P1） | 成功转换落一条记录（最多 100 条），队列页可回看产物大小、校验结果并打开所在文件夹 |
| **批量队列**（P1） | 拖拽多个文件或「添加文件」多选即入队；单并发 FIFO，入队即预定输出路径；队列条目显示排队位次 / 进度 / 失败原因 |
| **转换页批量组装**（P1） | 转换页就能凑一批：逐个「加入下一个视频」或一次多选，整批统一一个目标格式，同批最多 10 个（单次添加与总数两条上限），满了按钮变灰并明说「已达上限」；1 个文件仍是原来的单文件流程 |
| **两种输出参数模式**（P1） | 共用全局参数（默认，任务跟随参数预设页）或单任务独立参数（每条任务自带格式与档位，可在队列里单独改） |
| **失败处理策略**（P1） | 设置页二选一：失败后继续跑剩下的，或暂停整个队列等用户处理；失败任务标红、记日志、可单独重试或删除 |

**不在 MVP / P1 内**（代码里已标 `P1` / `P2`）：硬件加速、深色模式、字幕与多音轨保留、画面裁剪/缩放、断点续传、队列持久化。
完整的下一阶段排序、每项的范围与验收标准见 **[docs/ROADMAP-P1.md](docs/ROADMAP-P1.md)**，
逐条状态见 [docs/BACKLOG.md](docs/BACKLOG.md)，
**下一步选哪项**见 [docs/EXTENSIONS.md](docs/EXTENSIONS.md)（27 项候选按优先级编号）。

---

## 2. 快速开始

```bash
pnpm install

# 1) FFmpeg 二进制（不入库，需手动放置）
#    下载 full build（必须含 libx264），解压后放到：
#    resources/bin/win32-x64/ffmpeg.exe
#    resources/bin/win32-x64/ffprobe.exe

# 2) 生成测试样本（集成测试用，同样不入库）
pnpm fixtures

# 3) 开发
pnpm dev
```

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动开发态（主进程/preload 热重载 + 渲染层 HMR） |
| `pnpm build` | 类型检查 + 构建 `dist/` 与 `dist-electron/` |
| `pnpm dist` | 构建并打 Windows NSIS 安装包到 `release/` |
| `pnpm dist:dir` | 只打包成目录形态（`release/<ver>/win-unpacked/`），跳过安装器，验证快 |
| `pnpm typecheck` / `pnpm lint` | 类型 / ESLint（0 warning 策略） |
| `pnpm test` | 纯函数单测（毫秒级，随时可跑） |
| `pnpm test:int` | 集成测试：真起 ffmpeg 转真文件 |
| `pnpm test:matrix` | 4×8 全组合回归，产出 `docs/regression-report.md` |
| `pnpm test:all` | 全量（串行，约 45s） |
| `pnpm fixtures` | 用本机 ffmpeg 生成 `tests/fixtures/` |
| `pnpm smoke:packaged` | 对着**打包后的应用**跑探测→转换→校验全链路（需先启动应用并开调试端口，见 5.1） |

> ⚠️ 如果终端本身跑在 Electron 里（如某些 IDE 的内嵌终端），`ELECTRON_RUN_AS_NODE=1`
> 会让 `electron.exe` 退化成普通 Node，表现是 `app` 为 undefined。用
> `env -u ELECTRON_RUN_AS_NODE pnpm dev` 启动即可。

---

## 3. 目录结构

```
.
├── src/
│   ├── main/                    Electron 主进程
│   │   ├── index.ts             窗口、单实例、退出前杀子进程
│   │   ├── core/
│   │   │   ├── ffmpeg/
│   │   │   │   ├── planner.ts   ★ 唯一的业务判定点（纯函数）
│   │   │   │   ├── probe.ts     ffprobe → MediaMeta，处理 5 个真实坑
│   │   │   │   ├── runner.ts    子进程 + -progress 解析 + 进程树 kill
│   │   │   │   ├── verify.ts    输出轻量校验
│   │   │   │   ├── errors.ts    stderr → 中文错误
│   │   │   │   └── paths.ts     二进制路径（开发/打包两态）
│   │   │   ├── fs/              输出路径避让、.part 临时文件
│   │   │   └── job/             ConversionJob 状态机 + JobManager 单并发队列调度 + history 历史存储
│   │   ├── ipc/                 通道注册（每个 handler 做运行时入参校验）；queue.ts 是唯一的参数解析点
│   │   ├── history.ts           历史存储单例（唯一 import electron 的地方）
│   │   ├── logger.ts            滚动日志（userData/logs/app.log）
│   │   └── store.ts             electron-store 设置
│   ├── preload/index.ts         具名 API 桥（不暴露 ipcRenderer）
│   ├── shared/                  共享的类型/矩阵/错误码 + queue.ts 队列纯规则 + batch.ts 批次数量规则（两端共用）
│   └── renderer/                React 界面（1:1 对齐 UI 原型）
├── resources/bin/<平台>-<架构>/  FFmpeg 二进制（不入库）
├── scripts/                     fixture 生成、CDP 截图 / 逐页巡检 / 打包态冒烟 / 队列与批次界面验证
├── tests/                       unit（纯函数）+ integration（真转码）
└── docs/
    ├── BACKLOG.md               P1 / P2 清单
    ├── ROADMAP-P1.md            MVP 之后的扩展规划（排序 / 范围 / 验收标准）
    ├── EXTENSIONS.md            拓展功能全景（已完成 / 待完成 27 项按优先级编号）
    ├── regression-report.md     32 组合回归结果（脚本生成）
    └── screenshots/             打包态五页 + P1 迭代（队列 / 批次）截图（CDP 抓取）
```

---

## 4. 关键实现说明

### 4.1 判定链路：源编码 × 容器矩阵

`src/shared/containers.ts` 用**数据**描述每个容器能接受哪些视频/音频编码，
`planner.ts` 据此做三选一判定：

```
videoAction = spec.videoCodecs.includes(src.video.codec) ? copy : encode
audioAction = 无音轨 ? none : spec.audioCodecs.includes(src.audio.codec) ? copy : encode
mode        = 画面copy ? (音频copy/none ? copy : remux) : transcode
```

三点值得注意：

1. `videoCodecs` 里存的是 **ffprobe 的 codec_name**（`h264`），
   `defaultVideo` 里存的是 **ffmpeg 的编码器名**（`libx264`），两套命名空间，
   由 `encoderCodec()` 对齐，并有单测钉死「默认编码器必须能产出该容器接受的编码」。
2. `-map 0:a:0?` 的问号是**可选映射**。少了它，纯视频文件会直接失败。
3. `-crf` 与 `-b:v` 互斥（VP9 例外，必须 `-crf N -b:v 0`）；
   `-preset` 只给 x264/x265，老编码器传了会报错。
4. **AVI 的白名单里故意不含 h264**：AVI 要 Annex-B 起始码，而 MP4/MKV 里的 H.264 是 AVCC，
   直接 copy 会被 muxer 拒绝（`h264 bitstream malformed, no startcode found`）。
   理论上加 `-bsf:v h264_mp4toannexb` 能塞进去，但产出的 AVI 老设备放不了——
   而「能被老设备播放」正是 AVI 在这个产品里唯一的存在理由。所以 AVI 一律重编码成 mpeg4。
   （这个问题是 32 组合回归测试跑出来的，单测发现不了。）

### 4.2 输出不覆盖、不留残片

写出顺序固定为 **写 `.part` → rename → 校验 → 置 done**：

- `.part` 命名为 `名字.part.扩展名`。写成 `名字.扩展名.part` 会让 ffmpeg
  因为「infer 不出封装器」而**每次转换都失败**（这是实测踩到过的坑）。
- 校验放在 rename 之后：顺序反了会出现「文件已删、状态却是完成」。
- 路径避让：`_converted` → `_converted_1`…，且与源文件同路径时强制换名，
  避免 mkv 转 mkv 把原片顶掉。

### 4.3 进度：`out_time_ms` 单位是微秒

`-progress pipe:1` 输出的 `out_time_ms` 名字骗人，值其实是**微秒**。
解析时优先 `out_time_us`，`out_time_ms` 只做兜底；`pct` 封顶 99，
只有 `progress=end` 或退出码 0 才置 100——否则用户会在文件还没写完时看到 100%。

### 4.4 安全基线

- `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`
- preload 只暴露具名函数（`window.api.xxx`），**不暴露 `ipcRenderer`**
- 每个 IPC handler 做运行时入参校验（路径必须是绝对路径）
- ffmpeg 一律 `spawn(exe, argsArray, { shell: false })`，零字符串拼接
- 外链只允许 `http/https`，其余交给系统浏览器打开
- 渲染进程拿不到 Node API；拖拽路径通过 preload 的 `webUtils.getPathForFile` 取

### 4.5 二进制路径：开发态与打包态同一套逻辑

```
开发：<项目根>/resources/bin/<platform>-<arch>/ffmpeg.exe
打包：<安装目录>/resources/bin/<platform>-<arch>/ffmpeg.exe   ← extraResources
```

两边只换 base 目录、相对结构完全一致，避免「开发能跑、装完 ENOENT」。
启动时自检不仅看文件在不在，还检查 `-encoders` 是否含 `libx264`
（LGPL 精简版没有，转 H.264 会直接 Unknown encoder）——缺了就让界面进引导态。

### 4.6 画质档位：一张表管三档，`standard` 永远等于 MVP

档位数值全部集中在 `shared/containers.ts`（`CRF_BY_TIER` / `BITRATE_FACTOR_BY_TIER` /
`AUDIO_BITRATE_BY_TIER`），planner 只负责取用，界面文案在 `renderer/lib/presets.ts`：

```
x264:   high 18 / standard 20 / small 26
其它:   high 22 / standard 24 / small 30
码率:   high 1.15× / standard 0.85× / small 0.45×（钳 800k~8000k）
音频:   high 256k / standard 192k / small 96k（opus 各降一档）
```

`standard` 的三组数值与 MVP 完全相同，并且有一条集成测试真转两次，
断言「不传档位」与「显式 standard」的**输出体积逐字节相同**——升级不能悄悄改掉老用户的结果。
直通场景完全不看档位，界面也不会显示档位提示（避免「选了体积优先却没变小」的误解）。

### 4.7 历史存储：可丢数据，绝不拖垮主链路

`userData/history.json`，最多 100 条，写入走 `.tmp` + rename 原子替换。
读取时任何异常（文件损坏、不是数组、字段缺失、权限不足）都退化成空列表并逐条过滤坏记录；
写失败只记日志。历史是「可有可无」的数据，不能因为它让转换或启动失败。
存储类不 import electron，路径由调用方注入，因此可以在 vitest 里直接 new 出来测。

### 4.8 批量队列：并发恒为 1，参数只解析一次

队列层只解决「排队」，不改变「同一时刻一个 ffmpeg」这条 MVP 前提。

- **调度**：`entries[] + activeId`，`activeId` 非空时绝不 pump；`done` / `cancelled` 立刻移出队列
  （成功结果进历史），`error` **留在队列里标红**，等用户重试或删除。
- **输出路径在入队时预定**：`reserved: Set<string>` 参与 `resolveOutputPath` 的存在性判断。
  少了这一步，同一源文件入队两次会算出同一个文件名，后者悄悄覆盖前者。
- **参数只解析一次**：渲染层只上报 `{ meta, globalTarget, custom }`，由主进程
  `resolveTaskParams` 结合设置算出最终 `target/preset`（优先级：任务自带 `custom` > 全局）。
  两边各算一次是「界面显示 WebM、实际写 MP4」这类问题的根源。
- **模式切换只影响新任务**：模式在**入队那一刻**读一次并固化进任务的 `custom`，
  所以「能不能编辑」判定的是条目自身有没有 `custom`，而不是当前模式。
- **失败策略在失败那一刻读取**：用户中途去设置页把「继续」改成「暂停」，下一次失败就按新策略走。
- **jobId 唯一贯穿**：`ConversionJob` 由队列传入 `jobId`，`progress / state / result`
  三处事件共用它，渲染层据此把事件归到对应卡片。

### 4.9 转换页批次：`batch[0]` 兼职「主文件」

转换页不只是单文件入口，也是一个**组装区**：可以先攒一批、整批统一目标格式，再一次性交给队列。

- **一个状态两副皮**：`batch: BatchEntry[]`。1 个文件时走原来的 `MediaCard + PlanSummary`，
  ≥2 个才切换成 `BatchList + BatchSummary`。`batch[0]` 与 `meta / plan / outputPath` 同源，
  单文件流程因此一行没改——不存在「主文件」和「批次」两套状态需要同步。
- **两条独立上限**（`src/shared/batch.ts`，纯函数，主进程和渲染层共用）：
  单次添加 ≤ 10、待转换总数 ≤ 10。判定顺序是**先看总数是否已满，再取 `min(单次上限, 剩余空位)`**，
  提示文案以「真正把数量压下来的那条约束」为准，所以有「已达上限」「一次最多 10 个」
  「这次只加入 N 个」三种说法，用户不会看到一句放之四海皆准的废话。
- **先算上限再探测**：被拒的文件不会白跑一遍 ffprobe。文件选择对话框只是「取路径」，
  真正的准入判定和探测都在 `addToBatch` 里，拖拽和点选走同一条路。
- **统一目标格式 = 整批重算**：`setTarget` / `chooseOutputDir` 用 `Promise.all` 逐条重算
  `plan` 与 `outputPath`。只改「当前文件」会让列表里残留旧扩展名，用户以为只变了一个。
- **两种规模去不同的地方看**：1 个文件留在转换页看实时进度（MVP 流程原样保留）；
  ≥2 个整批入队后跳任务队列页——十几个进度条挤在转换页没有意义，排队位次和失败处理都在队列里。

---

## 5. 测试

| 层 | 文件 | 手段 |
|---|---|---|
| 纯函数 | `tests/unit/*.test.ts` | 177 例。planner 判定矩阵与档位、容器矩阵自洽、stderr 翻译与 errno 映射、路径避让、ffprobe 归一化、历史存取与容错、队列参数解析与状态判定、批次数量规则（单次/总数两条上限与三种提示文案） |
| 集成 | `tests/integration/*.test.ts` | 36 例。真 ffprobe 读真文件、真 ffmpeg 转码、真实取消、校验失败删文件、档位对产物大小的真实影响、队列 FIFO / 路径预定 / 两种失败策略 / 重试 |
| 回归 | `tests/regression/matrix.test.ts` | 32 例。4 类源 × 8 目标全组合真转 + ffprobe 读回，报告见 [docs/regression-report.md](docs/regression-report.md) |

集成/回归测试检测不到 ffmpeg 或 fixture 时会 **skip 并打印醒目警告**，
不会假装通过。当前 32/32 组合通过（含直通、混合直通、全量重编码三种路径）。

### 5.1 打包态验证（不只看「构建成功」）

开发态跑通 ≠ 装完能跑：两者的二进制路径完全不同。所以额外做一层打包后验证：

```bash
pnpm dist:dir                       # 产出 release/0.1.0/win-unpacked/
release/0.1.0/win-unpacked/VideoConverter.exe --no-sandbox --remote-debugging-port=9223
node scripts/smoke-packaged.mjs 9223     # 通过 window.api 跑真实链路
node scripts/cdp-nav-check.mjs 9223      # 逐页点一遍并截图
```

开发态的界面自动化走另一个开关（不必临时改代码）：

```bash
CDP_PORT=9222 pnpm dev                         # 另一个终端
node scripts/cdp-queue-check.mjs 9222          # 批量队列 24 条断言 + 4 张截图
node scripts/cdp-batch-check.mjs 9222          # 转换页批量 38 条断言 + 4 张截图
```

`cdp-queue-check.mjs` 用**真实转码**驱动界面：入队 → 切模式 → 单独改参数 →
制造一次失败 → 验证暂停与恢复，并把截图写进 `docs/screenshots`。
`cdp-batch-check.mjs` 备 15 个真实视频副本，逐条验证单次上限 / 总数上限 / 满额禁用 /
整批换扩展名 / 批次入队跳转，最后回归一遍单文件流程。截图前会等 toast 自动消失
（长页面另用临时放大的视口拍全），避免提示条被遮住。

实测结果（本机 Windows 11 / electron 44.9.0）：

| 检查项 | 结果 |
|---|---|
| `capabilities.packaged` | `true` |
| 引擎路径 | `<安装目录>/resources/bin/win32-x64/ffmpeg.exe`（extraResources 生效） |
| 引擎版本 / libx264 | `9.0.2-full_build` / 有 |
| H.264+AAC → WebM | `transcode`，1.1s，201 KB → 141 KB，`verified: true` |
| `.part` 残留 | 无 |
| 五个页面 | 全部正常渲染，见 [docs/screenshots](docs/screenshots) |

安装包（NSIS，`oneClick: false`、可改安装路径）也能正常产出，见 `release/<ver>/VideoConverter-Windows-<ver>-Setup.exe`。

---

## 6. 已知限制（MVP / P1 有意为之）

1. **只处理第一条视频流 + 第一条音轨**；字幕轨与额外音轨会被丢弃，转换前会明确提示。
2. **重编码参数不可微调**：只有三档预设（高清优先 / 标准 / 体积优先），不支持手填 CRF、双遍编码或目标体积。
   直通（只换封装）不经过编码器，因此档位对它是空操作。
3. **校验是容器级的**：只确认「时长对得上、流没丢、文件不是 0 字节」，不做逐帧比对（P1-06）。
4. **并发固定为 1**：队列可以排很多任务，但同一时刻只跑一个 ffmpeg（抢 CPU 会让进度与失败归因都不可信）；
   并发数调节在设置页如实标注为「后续版本」。
5. **队列不持久化**：重启应用后队列清空（成功的结果仍留在「最近记录」里）；崩溃恢复见 BACKLOG P2-06。
6. **同批上限 10 个**：转换页一次最多组装 10 个视频（单次添加与总数各一条上限）；
   队列页「添加文件」按单次 10 个截断，但不限制队列总长度——排队长短由用户自己掌握。
7. **无断点续传**：取消或失败后重试是从头再转，不做段级续传。
8. **历史只记成功**：失败与取消不进历史；失败任务留在队列里可以重试或删除，但不会进历史列表。
9. **深色模式未实现**：Token 已预埋，开关按原型置灰。
10. **只验证了 Windows x64**：`extraResources` 复制 `resources/bin` 整棵树，
    其他平台需要自行放入对应目录的二进制；安装器未做代码签名，SmartScreen 会提示未知发布者。

---

## 7. 与《MVP开发计划》的差异

计划是纸面推演，实现时有三处必须调整，均已同步到代码注释：

| 计划 | 实际 | 原因 |
|---|---|---|
| `scripts/make-fixtures.ps1` | `scripts/make-fixtures.mjs` | PowerShell 传中文/括号路径易踩引号坑；Node 脚本与本机 ffmpeg 版本无关，且跨平台 |
| `asarUnpack: resources/bin/**` | `extraResources` 复制到 `resources/bin` | 二进制不在 asar 里（`files` 只含 dist/dist-electron），`asarUnpack` 对它无效；主进程需要能直接 spawn |
| `.part` 命名为 `xxx.mp4.part` | `xxx.part.mp4` | 后缀变了 ffmpeg 推断不出封装器，每次转换都会失败（实测） |

---

## 8. 许可与合规

本产品使用 FFmpeg（GPL v3）作为转换引擎，未修改其源码。
随包分发的 FFmpeg 二进制来自 [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 的 full build，
分发时需一并提供其源码获取方式（`ffmpeg.org`）。
