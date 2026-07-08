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
}

export type JobStatus = 'idle' | 'preparing' | 'running' | 'done' | 'cancelled' | 'error';

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
  target?: ContainerKey;
  progress?: ProgressPayload;
  result?: JobResult;
  error?: JobError;
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
  /** 参数预设页的选择，MVP 只持久化、不参与转换 */
  presets: Record<ContainerKey, PresetTier>;
}

/** 「复制诊断信息」的内容载体，由主进程拼装 */
export interface Diagnostics {
  text: string;
}
