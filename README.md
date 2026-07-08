# 视频转换器（Video Converter Desktop）

本地视频格式转换桌面客户端。拖入一个视频，选一个目标格式，应用负责两件事：
**让它一定能用**，以及**告诉你为什么之前不行**。

- Electron 44 + React 19 + TypeScript 5.9 + Vite 8 + Tailwind 4
- 转码引擎 FFmpeg（GPL，随包分发，全程离线）
- Windows 桌面端，无服务端、无账号、无上传

---

## 1. 现在能做什么（MVP 范围）

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

**不在 MVP 内**（代码里已标 `P1` / `P2`，详见 [docs/BACKLOG.md](docs/BACKLOG.md)）：批量队列与历史记录、参数预设真正生效、硬件加速、深色模式、字幕与多音轨保留、画面裁剪/缩放。

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
| `pnpm typecheck` / `pnpm lint` | 类型 / ESLint（0 warning 策略） |
| `pnpm test` | 纯函数单测（毫秒级，随时可跑） |
| `pnpm test:int` | 集成测试：真起 ffmpeg 转真文件 |
| `pnpm test:all` | 全量（串行，约 16s） |
| `pnpm fixtures` | 用本机 ffmpeg 生成 `tests/fixtures/` |

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
│   │   │   └── job/             ConversionJob 状态机 + JobManager 单任务调度
│   │   ├── ipc/                 通道注册（每个 handler 做运行时入参校验）
│   │   ├── logger.ts            滚动日志（userData/logs/app.log）
│   │   └── store.ts             electron-store 设置
│   ├── preload/index.ts         具名 API 桥（不暴露 ipcRenderer）
│   ├── shared/                  主进程与渲染进程共享的类型/矩阵/错误码
│   └── renderer/                React 界面（1:1 对齐 UI 原型）
├── resources/bin/<平台>-<架构>/  FFmpeg 二进制（不入库）
├── scripts/                     fixture 生成、CDP 截图
├── tests/                       unit（纯函数）+ integration（真转码）
└── docs/BACKLOG.md              P1 / P2 清单
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

---

## 5. 测试

| 层 | 文件 | 手段 |
|---|---|---|
| 纯函数 | `tests/unit/*.test.ts` | 118 例。planner 判定矩阵、容器矩阵自洽、stderr 翻译、路径避让、ffprobe 归一化 |
| 集成 | `tests/integration/*.test.ts` | 27 例。真 ffprobe 读真文件、真 ffmpeg 转码、真实取消、校验失败删文件 |

集成测试检测不到 ffmpeg 或 fixture 时会 **skip 并打印醒目警告**，
不会假装通过。

---

## 6. 已知限制（MVP 有意为之）

1. **只处理第一条视频流 + 第一条音轨**；字幕轨与额外音轨会被丢弃，转换前会明确提示。
2. **固定重编码参数**：兼容性优先的固定 CRF/码率，暂不接受用户调节（预设页只持久化不生效）。
3. **校验是容器级的**：只确认「时长对得上、流没丢、文件不是 0 字节」，不做逐帧比对（P1-06）。
4. **单任务**：同一时刻只允许一个转换，并发会抢 CPU 且难做进度归因。
5. **无断点续传**：取消后从头再来。
6. **深色模式未实现**：Token 已预埋，开关按原型置灰。
7. **打包仅验证 Windows x64**：`extraResources` 复制 `resources/bin` 整棵树，
   其他平台需要自行放入对应目录的二进制。

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
