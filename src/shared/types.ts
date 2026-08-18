/**
 * 主进程与渲染进程共享的类型定义。
 *
 * ⚠️ 纪律：本目录下的文件**不得** import `node:*` 或 `electron`。
 * 它会被打进渲染进程，任何 Node 依赖都会在浏览器环境报错。
 */
import type { AudioFormat } from './audio';

/** 音频格式定义在 audio.ts（它有自己的格式表），这里转发一次方便调用方统一从 types 取 */
export type { AudioFormat };

/** 8 个目标容器 */
export type ContainerKey = 'mp4' | 'mkv' | 'avi' | 'mov' | 'flv' | 'wmv' | 'webm' | 'mpeg';

export interface VideoStream {
  codec: string;
  codecLongName: string;
  width: number;
  height: number;
  /** 已归一化的帧率，如 29.97 */
  fps: number;
  /** r_frame_rate 与 avg_frame_rate 差异 > 1% 视为可变帧率 */
  isVfr: boolean;
  bitrateKbps: number | null;
  pixFmt: string;
  /** 从 pixFmt 解析，如 yuv420p10le → 10 */
  bitDepth: number;
}

export interface AudioStream {
  codec: string;
  sampleRate: number;
  channels: number;
  bitrateKbps: number | null;
}

export interface MetaWarning {
  code: 'VFR' | 'BIT_DEPTH_10' | 'NO_AUDIO' | 'MULTI_AUDIO' | 'SUBTITLE_PRESENT';
  message: string;
}

export interface MediaMeta {
  path: string;
  fileName: string;
  sizeBytes: number;
  durationSec: number;
  /** 可能是逗号多值，如 'matroska,webm' */
  formatName: string;
  video: VideoStream | null;
  /** MVP 只取第一条 */
  audio: AudioStream | null;
  audioTracks: number;
  subtitleTracks: number;
  warnings: MetaWarning[];
}

export type ConversionMode = 'copy' | 'remux' | 'transcode';

export interface PlanWarning {
  code: 'SUBTITLE_DROPPED' | 'EXTRA_AUDIO_DROPPED' | 'VFR_SOURCE' | 'BIT_DEPTH_REDUCED' | 'NO_AUDIO';
  message: string;
}

/**
 * 手动画质参数（精细调节）。
 *
 * 全部可选：没填的维度回到档位取值，所以「只改音频码率」不会连带把 CRF 也改掉。
 * `enabled` 是 UI 的开关位——关掉时整体忽略，省得用户把面板收起来还得先清空数值。
 */
export interface QualityOverrides {
  /** false / undefined = 不走手工参数（保存了值也不生效） */
  enabled?: boolean;
  /** 视频编码器名，如 libx264 / mpeg4；容器不支持时会回落到默认编码器并给说明 */
  videoEncoder?: string;
  /** CRF：数值越小画质越好。只有在支持 CRF 的编码器上生效，与 `videoBitrateKbps` 互斥 */
  crf?: number;
  /** 目标视频码率（kbps）：对不支持 CRF 的编码器生效，钳在 100–50000 */
  videoBitrateKbps?: number;
  /** 音频码率，如 `192k`；格式非法时回落到档位值 */
  audioBitrate?: string;
  /** 编码速度 `-preset`：只有 x264 / x265 认这个值 */
  speed?: string;
}

/** 最终生效的画质参数（planner 算完的结果，UI 与诊断信息据此显示） */
export interface QualitySpec {
  encoder: string;
  /** CRF 模式才有值；码率模式为 null */
  crf: number | null;
  /** 码率模式才有值；CRF 模式为 null */
  bitrateKbps: number | null;
  audioBitrate: string;
  /** 只有 x264 / x265 有值 */
  speedPreset: string | null;
  /** 用户填的值越界或不被支持时的说明（负责任的 Airbnb 式提示：说清改了什么） */
  notes: string[];
}

export interface PlanResult {
  mode: ConversionMode;
  videoAction: 'copy' | 'encode';
  audioAction: 'copy' | 'encode' | 'none';
  /** 不含 ffmpeg 路径、不含输入/输出文件、不含 -progress（那是 runner 的职责） */
  args: string[];
  warnings: PlanWarning[];
  estimate: { kind: 'instant' | 'encoded'; approxSeconds: number; qualityNote: string };
  /** 本次判定采用的画质档位（来自参数预设页）；直通模式下它不参与编码 */
  preset: PresetTier;
  /**
   * 本次实际生效的编码参数。
   * 直通模式下 `notes` 里会说明「不经过编码器，以下参数不会被使用」。
   */
  quality: QualitySpec;
}

/**
 * 音频提取的规划结果（TODO-20）。
 *
 * 与 `PlanResult` 平行而不是塞进它：音频输出没有视频流，
 * 若共用 `videoAction` / `quality.encoder` 这些字段，
 * 每个读它的地方都要先判断「这次到底有没有画面」。
 */
export interface AudioPlanResult {
  format: AudioFormat;
  /** 源音频编码正好是目标格式 → copy（音质 100% 保留）；否则必须重编码 */
  audioAction: 'copy' | 'encode';
  /** 实际使用的音频编码器；copy 时为 'copy' */
  encoder: string;
  /** 目标码率；copy 时为源音频的码率（可能为 null，界面按「不变」显示） */
  bitrate: string | null;
  args: string[];
  warnings: PlanWarning[];
  estimate: { kind: 'instant' | 'encoded'; approxSeconds: number; qualityNote: string };
  /** 预估输出体积：音频按「时长 × 码率」算，比视频那套准得多 */
  estimateBytes: number;
  preset: PresetTier;
}

export type JobStatus =
  | 'idle'
  /** 已入队，等待前面的任务 */
  | 'pending'
  | 'preparing'
  | 'running'
  | 'done'
  | 'cancelled'
  | 'error';

export interface ProgressPayload {
  jobId: string;
  /** 0~100，封顶 99（只有真正结束才 100） */
  pct: number;
  /** 倍速，如 1.8 */
  speed: number;
  etaSec: number | null;
  processedSec: number;
  totalSec: number;
}

export interface JobResult {
  jobId: string;
  outputPath: string;
  outputSizeBytes: number;
  sourceSizeBytes: number;
  elapsedMs: number;
  mode: ConversionMode;
  /** 轻量校验是否通过（见 core/ffmpeg/verify.ts） */
  verified: boolean;
  verifyDetail?: string;
}

export interface JobError {
  code: string;
  message: string;
  hint?: string;
  /** 末 20 行 stderr，用于「复制诊断信息」 */
  detail?: string;
}

/**
 * 一个任务的完整快照。
 *
 * `preset` / `sourceSizeBytes` 是为了让**终态事件自带落历史所需的全部信息**：
 * 失败与取消没有 `result`，如果还要回头去队列里翻条目，就会出现
 * 「条目已经被移出去了，历史里只剩文件名」的空记录。
 */
export interface JobSnapshot {
  status: JobStatus;
  jobId?: string;
  fileName?: string;
  /** 源文件路径：历史记录需要，失败诊断也要 */
  sourcePath?: string;
  target?: ContainerKey;
  preset?: PresetTier;
  /** 非空 = 这次是音频提取（TODO-20）；history 靠它区分「转成 MP4」与「抽成 MP3」 */
  audio?: AudioFormat | null;
  /** 失败/取消时也要能记下源文件多大 */
  sourceSizeBytes?: number;
  progress?: ProgressPayload;
  result?: JobResult;
  error?: JobError;
}

/**
 * 输出参数模式（批量队列）。
 *
 * - `shared`   共用全局参数：新增任务不携带自定义参数，执行时按「全局面板」解析
 * - `per-task` 单任务独立参数：任务携带 target + preset，可单独编辑
 *
 * 切换模式只影响**后续新增**的任务，已入队的任务参数不变。
 */
export type QueueMode = 'shared' | 'per-task';

/** 任务失败后的队列行为 */
export type FailurePolicy = 'continue' | 'pause';

/** 任务自带参数（单任务独立参数模式）；null 表示跟随全局 */
export interface TaskParams {
  target: ContainerKey;
  preset: PresetTier;
}

/** 队列里的一条任务（IPC 与界面共用的视图对象） */
export interface QueueItem {
  jobId: string;
  fileName: string;
  sourcePath: string;
  outputPath: string;
  /** 实际生效的目标格式（custom 优先，否则继承全局） */
  target: ContainerKey;
  /** 实际生效的画质档位（custom 优先，否则取全局该容器的档位） */
  preset: PresetTier;
  /** 非空 = 该任务自带参数，优先级高于全局 */
  custom: TaskParams | null;
  status: JobStatus;
  mode: ConversionMode | null;
  /** 非空 = 这条是音频提取任务（TODO-20），此时 `target` 只是展示用，不参与编码 */
  audio: AudioFormat | null;
  sourceSizeBytes: number;
  progress?: ProgressPayload;
  result?: JobResult;
  error?: JobError;
  createdAt: number;
}

export interface QueueSnapshot {
  items: QueueItem[];
  activeId: string | null;
  /** 并发时同时在跑的全部任务（TODO-10）；`activeId` 取其中最早那条 */
  activeIds: string[];
  /**
   * 这一批的整体进度（TODO-10）。
   * 并发时「还剩几个没跑」比「某一个跑到 42%」有用得多。
   */
  batch: { total: number; settled: number } | null;
  paused: boolean;
  /** 暂停原因：目前只有「失败即暂停」一种 */
  pausedReason: 'failure' | null;
  mode: QueueMode;
  policy: FailurePolicy;
}

/**
 * 入队请求的单条描述（渲染层 → 主进程）。
 *
 * 只上报「任务自带参数」与「全局面板选中的格式」，
 * 最终 target/preset 由主进程按 resolveTaskParams 统一解析。
 */
export interface EnqueueItemInput {
  meta: MediaMeta;
  /** 全局面板当前选中的格式；custom 为 null 时生效 */
  globalTarget?: ContainerKey;
  custom: TaskParams | null;
  /** 非空 = 这条走音频提取（TODO-20），与 target 互斥 */
  audio?: AudioFormat | null;
}

/** 历史条目的结局（TODO-07）：旧数据没有这个字段，一律视为 `done` */
export type HistoryStatus = 'done' | 'failed' | 'cancelled';

/**
 * 一条转换历史（成功 / 失败 / 取消都记）。
 *
 * 有意冗余存 `fileName` / `target` / 体积：历史要能独立展示，
 * 不能依赖源文件还在不在——用户很可能转完就删了原片。
 *
 * `preset` 是为了「一键重跑」：重跑必须按原参数，用户此刻的全局档位不该覆盖它。
 */
export interface HistoryEntry {
  /** 复用 jobId：天然唯一，重复写入可幂等去重 */
  id: string;
  fileName: string;
  sourcePath: string;
  outputPath: string;
  target: ContainerKey;
  mode: ConversionMode;
  preset: PresetTier;
  sourceSizeBytes: number;
  outputSizeBytes: number;
  elapsedMs: number;
  verified: boolean;
  /** epoch ms，列表按它倒序 */
  finishedAt: number;
  status: HistoryStatus;
  /** 非空 = 这次是音频提取（TODO-20） */
  audio?: AudioFormat | null;
  /** 失败/取消时的原因（成功时为 undefined） */
  error?: { code: string; message: string };
}

/**
 * 列表读出来的历史条目（TODO-07）。
 *
 * 多出来的 `sourceExists` 是**现场判定**，不落盘：
 * 「重跑」按钮要先知道源文件还在不在，而每次记一条历史时都存一个布尔值毫无意义
 * ——文件会在记录写完之后才被删掉。
 */
export interface HistoryItem extends HistoryEntry {
  sourceExists: boolean;
}

/** IPC 统一返回包装：不抛异常，避免 Electron 把错误序列化成难解析的字符串 */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; detail?: string } };

/** 启动自检结果，供关于页/设置页/引导态使用 */
export interface Capabilities {
  ffmpeg: {
    ok: boolean;
    version: string | null;
    /** 是否含 libx264（LGPL 精简版会缺，这是最高频的翻车点） */
    hasLibx264: boolean;
    ffmpegPath: string;
    ffprobePath: string;
    missing: string[];
  };
  app: { version: string; electron: string; chrome: string; node: string; platform: string };
  /** 是否处于打包态，仅用于诊断展示 */
  packaged: boolean;
}

export type PresetTier = 'high' | 'standard' | 'small';

/** 主题模式：`system` 时跟随系统（并在系统切换时立即变化） */
export type ThemeMode = 'light' | 'dark' | 'system';

export interface Settings {
  /** 默认保存位置；null 表示「源文件同级」 */
  defaultSavePath: string | null;
  defaultOutputFormat: ContainerKey;
  openFolderAfterDone: boolean;
  density: 'normal' | 'compact';
  /**
   * 主题（TODO-06）。
   * 默认 'light'：与 MVP 的观感逐字一致，深色是用户主动选的，不是升级送的惊喜。
   */
  theme: ThemeMode;
  /**
   * 参数预设页的质量档位。P1 起真实参与编码：
   * 直通（copy）不改编码参数，因此档位对它是空操作。
   */
  presets: Record<ContainerKey, PresetTier>;
  /**
   * 精细调节：每种格式的手动画质参数（TODO-01）。
   * 缺省为空对象 —— 没配过的容器完全按档位走，与老版本逐字节一致。
   */
  quality: Partial<Record<ContainerKey, QualityOverrides>>;
  /**
   * 输出命名：模板 + 重名策略（TODO-02）。
   * 默认模板 `{name}_converted` + `rename`，与 MVP 的文件名完全一致。
   */
  naming: { template: string; conflict: ConflictPolicy };
  /** 批量队列的输出参数模式；切换只影响后续新增任务 */
  queueMode: QueueMode;
  /** 任务失败后的队列行为 */
  failurePolicy: FailurePolicy;
  /** 全部任务结束后发一条系统通知（TODO-08） */
  notifyOnFinish: boolean;
  /** 同时运行的转码任务数 1–4（TODO-10） */
  concurrency: number;
  /** 关窗时最小化到托盘继续转码（TODO-14）；关闭则关窗即退出 */
  closeToTray: boolean;
  /** 上次被强杀时，重启后恢复未完成的队列（TODO-12） */
  restoreQueue: boolean;
}

/** 「复制诊断信息」的内容载体，由主进程拼装 */
export interface Diagnostics {
  text: string;
}

/**
 * 输出文件重名时的处理策略。
 * - `rename`    自动加序号（默认，与 MVP 行为一致）
 * - `overwrite` 直接覆盖同名文件
 * - `skip`      跳过该文件（批量时这个文件的任务不生成）
 */
export type ConflictPolicy = 'rename' | 'overwrite' | 'skip';

/**
 * 一批任务的最终账（TODO-08）。
 *
 * 按「结局」分三桶而不是只给一个成功数：用户真正要区分的是
 * 「全成了」还是「有失败的」，后者需要他回来处理。
 */
export interface BatchSummary {
  done: number;
  failed: number;
  cancelled: number;
}

/** 磁盘空间预检结果 */
export interface DiskEstimate {
  /** 这次转换预计需要的空间 */
  requiredBytes: number;
  /** null = 查不到可用空间（网络盘/权限），调用方按「不阻挡」处理 */
  freeBytes: number | null;
  enough: boolean;
  /** 还差多少字节（充足时为 0） */
  shortfallBytes: number;
}

/** 输出命名模板的可替换字段 */
export interface NamingTokens {
  /** 源文件名（不含扩展名） */
  name: string;
  /** 目标格式短名，如 MP4 */
  format: string;
  /** YYYYMMDD */
  date: string;
  /** HHmm */
  time: string;
  /** 批量序号（已补零）；单文件时为空串 */
  index: string;
  /** 画质档位 key */
  preset: string;
}
