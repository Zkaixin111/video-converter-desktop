/**
 * 主进程与渲染进程共享的类型定义。
 *
 * ⚠️ 纪律：本目录下的文件**不得** import `node:*` 或 `electron`。
 * 它会被打进渲染进程，任何 Node 依赖都会在浏览器环境报错。
 */

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

export interface JobSnapshot {
  status: JobStatus;
  jobId?: string;
  fileName?: string;
  /** 源文件路径：历史记录需要，失败诊断也要 */
  sourcePath?: string;
  target?: ContainerKey;
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
  sourceSizeBytes: number;
  progress?: ProgressPayload;
  result?: JobResult;
  error?: JobError;
  createdAt: number;
}

export interface QueueSnapshot {
  items: QueueItem[];
  activeId: string | null;
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
}

/**
 * 一条转换历史（只在成功时写入）。
 *
 * 有意冗余存 `fileName` / `target` / 体积：历史要能独立展示，
 * 不能依赖源文件还在不在——用户很可能转完就删了原片。
 */
export interface HistoryEntry {
  /** 复用 jobId：天然唯一，重复写入可幂等去重 */
  id: string;
  fileName: string;
  sourcePath: string;
  outputPath: string;
  target: ContainerKey;
  mode: ConversionMode;
  sourceSizeBytes: number;
  outputSizeBytes: number;
  elapsedMs: number;
  verified: boolean;
  /** epoch ms，列表按它倒序 */
  finishedAt: number;
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

export interface Settings {
  /** 默认保存位置；null 表示「源文件同级」 */
  defaultSavePath: string | null;
  defaultOutputFormat: ContainerKey;
  openFolderAfterDone: boolean;
  density: 'normal' | 'compact';
  /**
   * 参数预设页的质量档位。P1 起真实参与编码：
   * 直通（copy）不改编码参数，因此档位对它是空操作。
   */
  presets: Record<ContainerKey, PresetTier>;
  /** 批量队列的输出参数模式；切换只影响后续新增任务 */
  queueMode: QueueMode;
  /** 任务失败后的队列行为 */
  failurePolicy: FailurePolicy;
}

/** 「复制诊断信息」的内容载体，由主进程拼装 */
export interface Diagnostics {
  text: string;
}
