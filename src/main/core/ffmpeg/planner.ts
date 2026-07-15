/**
 * 参数规划器 —— 全项目唯一的业务决策点，也是最需要被单测覆盖的地方。
 *
 * 两条硬纪律（会被 lint 与单测共同守护）：
 *   1. 纯函数：不碰文件系统、不碰子进程、不碰时间戳/随机数。
 *   2. 不 import electron / node:fs —— 这是它能被单测、也能在将来迁移到 Tauri 原样搬走的前提。
 */
import {
  CONTAINERS,
  audioBitrateFor,
  buildVideoQualityArgs,
  isContainerKey,
  isPresetTier,
} from '../../../shared/containers';
import { AppError } from '../../../shared/errors';
import type {
  ContainerKey,
  ConversionMode,
  MediaMeta,
  PlanResult,
  PlanWarning,
  PresetTier,
} from '../../../shared/types';

export interface PlanInput {
  meta: MediaMeta;
  target: ContainerKey;
  options?: {
    /** P1：分辨率缩放预留，当前未接入 */
    scaleHeight?: number;
    /** 画质档位，来自参数预设页；缺省 standard 与 MVP 行为一致 */
    preset?: PresetTier;
  } | null;
}

/** 重编码时的预估系数：transcode 约 0.5× 实时，remux 只转音频，快得多 */
const TRANSCODE_SPEED_FACTOR = 0.5;
const REMUX_SPEED_FACTOR = 0.15;

export function planConversion(input: PlanInput): PlanResult {
  const { meta, target } = input;
  // 档位来自参数预设页。非法值一律当 standard 处理，不让脏设置把转码带崩。
  const preset: PresetTier = isPresetTier(input.options?.preset)
    ? input.options.preset
    : 'standard';

  // ── 1. 前置校验 ──────────────────────────────────────────────
  if (!isContainerKey(target)) {
    throw new AppError('E_UNSUPPORTED_TARGET', `不支持的目标格式：${String(target)}`);
  }
  if (!meta.video) {
    throw new AppError(
      'E_NO_VIDEO_STREAM',
      '这个文件里没有视频画面，不能转换成视频格式。',
      { hint: '如果你想提取音频，这属于后续版本的能力。' },
    );
  }

  const spec = CONTAINERS[target];
  const video = meta.video;

  // ── 2. 判定视频：能否直接装进目标容器 ─────────────────────────
  const videoAction: 'copy' | 'encode' = spec.videoCodecs.includes(video.codec)
    ? 'copy'
    : 'encode';

  // ── 3. 判定音频 ────────────────────────────────────────────
  let audioAction: 'copy' | 'encode' | 'none';
  if (!meta.audio) {
    audioAction = 'none';
  } else if (spec.audioCodecs.includes(meta.audio.codec)) {
    audioAction = 'copy';
  } else {
    audioAction = 'encode';
  }

  // ── 4. 定模式 ──────────────────────────────────────────────
  const mode: ConversionMode =
    videoAction === 'copy'
      ? audioAction === 'copy' || audioAction === 'none'
        ? 'copy'
        : 'remux'
      : 'transcode';

  // ── 5. 组装参数 ────────────────────────────────────────────
  // `0:a:0?` 的问号是「可选映射」：没有音轨时忽略而不是报错。
  // 少了这个问号，纯视频文件会直接失败 —— 这是最高频的踩坑点。
  const args: string[] = ['-map', '0:v:0', '-map', '0:a:0?'];

  if (videoAction === 'copy') {
    args.push('-c:v', 'copy');
  } else {
    args.push('-c:v', spec.defaultVideo);
    // 只有 x264/x265 这类软编才认 preset，老编码器传了会直接报错
    if (spec.defaultVideo === 'libx264' || spec.defaultVideo === 'libx265') {
      args.push('-preset', 'veryfast');
    }
    args.push(...buildVideoQualityArgs(spec.defaultVideo, video.bitrateKbps, preset));
    // 强制 8bit 4:2:0，兼容性最高（10bit 源在这里会被降到 8bit，下面会给警告）
    args.push('-pix_fmt', 'yuv420p');
  }

  if (audioAction === 'copy') {
    args.push('-c:a', 'copy');
  } else if (audioAction === 'encode') {
    args.push('-c:a', spec.defaultAudio, '-b:a', audioBitrateFor(spec.defaultAudio, preset));
  }

  if (spec.faststart) {
    args.push('-movflags', '+faststart');
  }

  // ── 6. 收集警告 ────────────────────────────────────────────
  const warnings: PlanWarning[] = [];

  if (meta.subtitleTracks > 0) {
    warnings.push({
      code: 'SUBTITLE_DROPPED',
      message: '字幕轨不会保留（当前版本只处理画面与第一条音轨）。',
    });
  }
  if (meta.audioTracks > 1) {
    warnings.push({
      code: 'EXTRA_AUDIO_DROPPED',
      message: `文件有 ${meta.audioTracks} 条音轨，当前只保留第一条。`,
    });
  }
  if (video.isVfr) {
    warnings.push({
      code: 'VFR_SOURCE',
      message: '源文件是可变帧率（VFR），转换后帧率会被固定。',
    });
  }
  if (
    videoAction === 'encode' &&
    video.bitDepth > 8 &&
    (spec.defaultVideo === 'libx264' || spec.defaultVideo === 'libx265')
  ) {
    warnings.push({
      code: 'BIT_DEPTH_REDUCED',
      message: '源文件是 10bit 色彩，输出会降到 8bit 以获得更好的兼容性。',
    });
  }
  if (!meta.audio) {
    warnings.push({
      code: 'NO_AUDIO',
      message: '这个文件没有音轨，输出文件也不会有声音。',
    });
  }

  // ── 7. 估算 ────────────────────────────────────────────────
  const sizeMB = meta.sizeBytes / 1024 / 1024;
  const durationSec = meta.durationSec > 0 ? meta.durationSec : 0;

  // 档位只影响「重新压缩」那条路：直通不经编码器，画质永远是 100%
  const transcodeNote: Record<PresetTier, string> = {
    high: '画质优先，体积可能比原文件更大',
    standard: '画质略有损失',
    small: '体积优先，画质有可见损失',
  };

  const estimate =
    mode === 'copy'
      ? {
          kind: 'instant' as const,
          // 直通基本是磁盘速度，按 300MB/s 粗算
          approxSeconds: Math.max(1, Math.round(sizeMB / 300)),
          qualityNote: '画质 100% 保留',
        }
      : {
          kind: 'encoded' as const,
          approxSeconds: Math.max(
            3,
            Math.round(durationSec * (mode === 'remux' ? REMUX_SPEED_FACTOR : TRANSCODE_SPEED_FACTOR)),
          ),
          qualityNote: mode === 'remux' ? '画面 100% 保留，仅音频转码' : transcodeNote[preset],
        };

  return { mode, videoAction, audioAction, args, warnings, estimate, preset };
}
