/**
 * 元数据探测：ffprobe → 归一化 MediaMeta。
 *
 * 这里要处理 5 个真实世界的坑（见方案 §3.3）：
 *   ① format_name 是逗号多值（'matroska,webm'），只能 includes 不能 ===
 *   ② r_frame_rate 是分数（'30000/1001'），要解析成 29.97
 *   ③ bit_rate 经常缺失，需要两级兜底
 *   ④ VFR 判定用 r_frame_rate vs avg_frame_rate，阈值 1%
 *   ⑤ 纯音频文件要返回 video: null，而不是抛错
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '../../../shared/errors';
import type {
  AudioStream,
  MediaMeta,
  MetaWarning,
  VideoStream,
} from '../../../shared/types';
import { getFfprobePath, getFfmpegPath } from './paths';

const execFileAsync = promisify(execFile);

/* ── ffprobe JSON 的宽松类型（只声明用到的字段） ─────────────────── */

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  bit_rate?: string;
  pix_fmt?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  disposition?: { default?: number; attached_pic?: number };
}

interface FfprobeFormat {
  format_name?: string;
  duration?: string;
  bit_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

/** '30000/1001' → 29.97；非法值返回 0 */
export function parseFraction(value: string | undefined): number {
  if (!value) return 0;
  const [num, den] = value.split('/');
  const n = Number(num);
  const d = den === undefined ? 1 : Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  return Math.round((n / d) * 100) / 100;
}

/** 'yuv420p10le' → 10；无位深信息按 8 处理 */
export function parseBitDepth(pixFmt: string | undefined): number {
  if (!pixFmt) return 8;
  const m = /p(\d{1,2})(?:le|be)?$/i.exec(pixFmt);
  if (m) {
    const v = Number(m[1]);
    if (v >= 9 && v <= 16) return v;
  }
  if (/^gray(10|12|16)/i.test(pixFmt)) return 10;
  return 8;
}

function num(v: string | number | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 归一化。抽成独立函数是为了能在单测里直接喂 ffprobe 的 JSON 片段，
 * 不必每次都起子进程。
 */
export function normalizeProbe(
  raw: FfprobeOutput,
  ctx: { path: string; sizeBytes: number },
): MediaMeta {
  const streams = raw.streams ?? [];
  const fmt = raw.format ?? {};

  const videoStreams = streams.filter(
    (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1,
  );
  const audioStreams = streams.filter((s) => s.codec_type === 'audio');
  const subtitleStreams = streams.filter((s) => s.codec_type === 'subtitle');

  // 只取 ffprobe 给的时长；format.duration 通常比流级更可靠
  const durationSec = num(fmt.duration) ?? num(videoStreams[0]?.duration) ?? 0;

  const audioKbps = num(audioStreams[0]?.bit_rate) ? Number(num(audioStreams[0]?.bit_rate)) / 1000 : null;
  const formatKbps = num(fmt.bit_rate) !== null ? Number(num(fmt.bit_rate)) / 1000 : null;

  let video: VideoStream | null = null;
  const vs = videoStreams[0];
  if (vs) {
    const rFps = parseFraction(vs.r_frame_rate);
    const avgFps = parseFraction(vs.avg_frame_rate);
    const baseFps = avgFps > 0 ? avgFps : rFps;
    // 差异 > 1% 视为 VFR
    const isVfr = rFps > 0 && avgFps > 0 && Math.abs(rFps - avgFps) / avgFps > 0.01;

    // 码率三级兜底：流级 → 容器级减去音频 → 按体积与时长估算
    let bitrateKbps = num(vs.bit_rate) !== null ? Number(num(vs.bit_rate)) / 1000 : null;
    if (bitrateKbps === null && formatKbps !== null) {
      bitrateKbps = Math.max(0, formatKbps - (audioKbps ?? 0));
    }
    if (bitrateKbps === null && durationSec > 0) {
      const sizeMB = ctx.sizeBytes / 1024 / 1024;
      bitrateKbps = Math.round(((sizeMB * 8192) / durationSec) * 0.95);
    }

    video = {
      codec: vs.codec_name ?? 'unknown',
      codecLongName: vs.codec_long_name ?? '',
      width: vs.width ?? 0,
      height: vs.height ?? 0,
      fps: baseFps,
      isVfr,
      bitrateKbps: bitrateKbps === null ? null : Math.round(bitrateKbps),
      pixFmt: vs.pix_fmt ?? '',
      bitDepth: parseBitDepth(vs.pix_fmt),
    };
  }

  let audio: AudioStream | null = null;
  const as = audioStreams[0];
  if (as) {
    audio = {
      codec: as.codec_name ?? 'unknown',
      sampleRate: num(as.sample_rate) ?? 0,
      channels: as.channels ?? 0,
      bitrateKbps: num(as.bit_rate) === null ? null : Math.round(Number(num(as.bit_rate)) / 1000),
    };
  }

  const warnings: MetaWarning[] = [];
  if (video?.isVfr) warnings.push({ code: 'VFR', message: '源文件是可变帧率，转换后会被固定帧率。' });
  if (video && video.bitDepth > 8) {
    warnings.push({ code: 'BIT_DEPTH_10', message: '源文件是 10bit 色彩。' });
  }
  if (!audio) warnings.push({ code: 'NO_AUDIO', message: '这个文件没有音轨。' });
  if (audioStreams.length > 1) {
    warnings.push({ code: 'MULTI_AUDIO', message: `文件有 ${audioStreams.length} 条音轨。` });
  }
  if (subtitleStreams.length > 0) {
    warnings.push({ code: 'SUBTITLE_PRESENT', message: '文件包含字幕轨。' });
  }

  return {
    path: ctx.path,
    fileName: path.basename(ctx.path),
    sizeBytes: ctx.sizeBytes,
    durationSec,
    formatName: fmt.format_name ?? '',
    video,
    audio,
    audioTracks: audioStreams.length,
    subtitleTracks: subtitleStreams.length,
    warnings,
  };
}

/** 真实探测：先 stat 拿大小（顺带把「文件不存在」与「文件坏」区分开） */
export async function probeMedia(filePath: string): Promise<MediaMeta> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new AppError('E_FILE_NOT_FOUND', '找不到这个文件，可能已经被移动或删除。', {
        detail: filePath,
      });
    }
    throw new AppError('E_FILE_UNREADABLE', '无法读取这个文件，可能被其他程序占用或没有权限。', {
      detail: String(err),
    });
  }
  if (!stat.isFile()) {
    throw new AppError('E_FILE_NOT_FOUND', '这个路径不是一个文件。', { detail: filePath });
  }

  const args = [
    // ⚠️ 必须是 error 而不是 quiet：
    // quiet 会把 stderr 一起吞掉，下面「moov atom not found / Invalid data」这两条
    // 精确错误映射就永远匹配不上，所有坏文件都只能落到笼统的 E_PROBE_FAILED。
    // error 级别下 JSON 结果不受影响，错误信息仍然可读。
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  let stdout: string;
  try {
    const res = await execFileAsync(getFfprobePath(), args, {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
    });
    stdout = res.stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const stderr = e.stderr ?? e.message ?? '';
    if (/moov atom not found/i.test(stderr)) {
      // 注意：截断的真 MP4 和「文本改名成 .mp4」在 ffprobe 眼里是同一句话，
      // 两者无法区分。这里选对常见情况（下载/拷贝中断）更有用的那句，
      // 并在 hint 里把「后缀可能不对」的情况一起兜住。
      throw new AppError(
        'E_CORRUPT_FILE',
        '这个文件没有正常结束，通常是下载或拷贝过程中断了。',
        {
          hint: '请重新获取原始文件；如果它本来就不是 MP4，请确认后缀名与真实格式一致。',
          detail: stderr.slice(-2000),
        },
      );
    }
    if (/Invalid data found/i.test(stderr)) {
      throw new AppError('E_INVALID_INPUT', '文件已损坏，或者后缀和真实格式不一致。', {
        hint: '可以尝试用播放器打开确认。',
        detail: stderr.slice(-2000),
      });
    }
    throw new AppError('E_PROBE_FAILED', '无法解析这个文件的信息，它可能不是有效的视频文件。', {
      detail: stderr.slice(-2000),
    });
  }

  let raw: FfprobeOutput;
  try {
    raw = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    throw new AppError('E_PROBE_FAILED', '无法解析文件信息（ffprobe 输出不是合法 JSON）。');
  }

  return normalizeProbe(raw, { path: filePath, sizeBytes: stat.size });
}

/**
 * 抽一帧做缩略图，返回 base64 dataURL。
 *
 * 关键点：`-ss` 必须在 `-i` 之前（快速 seek，否则要解码到第 2 秒）；
 * 失败时降级到第 0 帧，再失败返回 null（UI 显示占位图，不影响主流程）。
 */
export async function extractThumbnail(
  filePath: string,
  atSec = 2,
): Promise<string | null> {
  const attempt = (seek: number): Promise<string | null> =>
    new Promise((resolve) => {
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        String(seek),
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-vf',
        'scale=320:-2',
        '-q:v',
        '3',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1',
      ];

      const child = spawn(getFfmpegPath(), args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        // 零字符串拼接、零 shell —— 路径里有中文/空格/括号也不会出事
        shell: false,
      });

      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 20_000);

      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.stderr.on('data', () => {
        /* 缩略图失败是常态（视频太短、解码器不支持），不打印噪音 */
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && chunks.length > 0) {
          resolve(`data:image/jpeg;base64,${Buffer.concat(chunks).toString('base64')}`);
        } else {
          resolve(null);
        }
      });
    });

  const first = await attempt(atSec);
  if (first) return first;
  if (atSec === 0) return null;
  return attempt(0);
}
