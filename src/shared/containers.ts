/**
 * 容器兼容矩阵 —— 全部业务判定的数据基础。
 *
 * 写成数据，不写成 if：新增一个容器只需要在这里加一项，
 * planner / UI / 测试会自动跟着走。
 *
 * ⚠️ `defaultVideo` 必须在该容器的 `videoCodecs` 白名单内，
 *    `defaultAudio` 同理（由 containers.test.ts 守护）。
 */
import type { ContainerKey } from './types';

export interface ContainerSpec {
  /** UI 上显示的短名 */
  label: string;
  /** 一句话场景说明（取自原型） */
  desc: string;
  ext: string;
  /** ffprobe 的 codec_name 白名单 */
  videoCodecs: string[];
  audioCodecs: string[];
  /** 重编码时用 */
  defaultVideo: string;
  defaultAudio: string;
  /** -f 参数 */
  muxer: string;
  /** 是否支持 -movflags +faststart */
  faststart: boolean;
}

export const CONTAINERS: Record<ContainerKey, ContainerSpec> = {
  mp4: {
    label: 'MP4',
    desc: '通用兼容',
    ext: '.mp4',
    muxer: 'mp4',
    faststart: true,
    videoCodecs: ['h264', 'hevc', 'av1', 'mpeg4', 'vp9'],
    audioCodecs: ['aac', 'mp3', 'ac3', 'eac3', 'alac'],
    defaultVideo: 'libx264',
    defaultAudio: 'aac',
  },
  mkv: {
    label: 'MKV',
    desc: '无损封装',
    ext: '.mkv',
    muxer: 'matroska',
    faststart: false,
    videoCodecs: [
      'h264',
      'hevc',
      'av1',
      'vp8',
      'vp9',
      'mpeg4',
      'mpeg2video',
      'wmv1',
      'wmv2',
      'wmv3',
      'vc1',
      'mpeg1video',
    ],
    audioCodecs: [
      'aac',
      'mp3',
      'ac3',
      'eac3',
      'opus',
      'vorbis',
      'flac',
      'dts',
      'truehd',
      'wmav2',
    ],
    defaultVideo: 'libx264',
    defaultAudio: 'aac',
  },
  avi: {
    label: 'AVI',
    desc: '老设备',
    ext: '.avi',
    muxer: 'avi',
    faststart: false,
    videoCodecs: ['mpeg4', 'h264', 'mpeg2video', 'mpeg1video', 'wmv2', 'wmv3'],
    audioCodecs: ['mp3', 'ac3', 'pcm_s16le', 'wmav2'],
    defaultVideo: 'mpeg4',
    defaultAudio: 'libmp3lame',
  },
  mov: {
    label: 'MOV',
    desc: '苹果生态',
    ext: '.mov',
    muxer: 'mov',
    faststart: true,
    videoCodecs: ['h264', 'hevc', 'mpeg4', 'prores'],
    audioCodecs: ['aac', 'mp3', 'ac3', 'alac', 'pcm_s16le'],
    defaultVideo: 'libx264',
    defaultAudio: 'aac',
  },
  flv: {
    label: 'FLV',
    desc: '网页旧版',
    ext: '.flv',
    muxer: 'flv',
    faststart: false,
    videoCodecs: ['h264'],
    audioCodecs: ['aac', 'mp3'],
    defaultVideo: 'libx264',
    defaultAudio: 'aac',
  },
  wmv: {
    label: 'WMV',
    desc: 'Windows',
    ext: '.wmv',
    muxer: 'asf',
    faststart: false,
    videoCodecs: ['wmv1', 'wmv2', 'wmv3', 'vc1'],
    audioCodecs: ['wmav1', 'wmav2'],
    defaultVideo: 'wmv2',
    defaultAudio: 'wmav2',
  },
  webm: {
    label: 'WebM',
    desc: '网页压缩',
    ext: '.webm',
    muxer: 'webm',
    faststart: false,
    videoCodecs: ['vp8', 'vp9', 'av1'],
    audioCodecs: ['opus', 'vorbis'],
    defaultVideo: 'libvpx-vp9',
    defaultAudio: 'libopus',
  },
  mpeg: {
    label: 'MPEG',
    desc: '老旧播放',
    ext: '.mpg',
    muxer: 'mpeg',
    faststart: false,
    videoCodecs: ['mpeg1video', 'mpeg2video'],
    audioCodecs: ['mp2', 'mp3', 'ac3'],
    defaultVideo: 'mpeg2video',
    defaultAudio: 'mp2',
  },
};

/** UI 展示顺序（与原型 §5.1 一致，不要按字母排） */
export const CONTAINER_ORDER: ContainerKey[] = [
  'mp4',
  'mkv',
  'avi',
  'mov',
  'flv',
  'wmv',
  'webm',
  'mpeg',
];

export function isContainerKey(v: unknown): v is ContainerKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CONTAINERS, v);
}

/**
 * 编码器名 → 它产出的 codec_name。
 *
 * ⚠️ 这是两套命名空间，别混用：
 *   · `videoCodecs` / `audioCodecs` 里放的是 **ffprobe 读出来的 codec_name**（h264、hevc、vp9）
 *   · `defaultVideo` / `defaultAudio` 里放的是 **ffmpeg -c:v 要的编码器名**（libx264、libvpx-vp9）
 *
 * 它们大多长得不一样（h264 ↔ libx264）。这张表把两套对齐，
 * 由 containers.test.ts 守护「默认编码器必须能产出该容器接受的编码」。
 */
export const ENCODER_CODEC: Record<string, string> = {
  libx264: 'h264',
  libx265: 'hevc',
  'libvpx-vp9': 'vp9',
  libsvtav1: 'av1',
  libmp3lame: 'mp3',
  libopus: 'opus',
};

/** 取编码器产出的 codec_name；本身就是 codec_name 的（mpeg4 / wmv2 / aac…）原样返回 */
export function encoderCodec(encoder: string): string {
  return ENCODER_CODEC[encoder] ?? encoder;
}

/**
 * 质量模式（CRF）编码器。其余编码器不支持 CRF，必须给目标码率。
 * 写错会导致编码失败或画质灾难，所以单独抽出来并配单测。
 */
export const CRF_ENCODERS = new Set(['libx264', 'libx265', 'libvpx-vp9', 'libsvtav1']);

/**
 * 视频质量参数。
 * - CRF 模式：x264/x265 用 20，其余用 24（同画质可用更高 CRF）
 * - VP9 必须配 `-b:v 0` 才是纯 CRF 模式
 * - 码率模式：不超过源码率的 85%，下限 800k，上限 8000k
 */
export function buildVideoQualityArgs(
  encoder: string,
  srcBitrateKbps: number | null,
): string[] {
  if (CRF_ENCODERS.has(encoder)) {
    const crf = encoder === 'libx264' ? '20' : '24';
    const extra = encoder === 'libvpx-vp9' ? ['-b:v', '0'] : [];
    return ['-crf', crf, ...extra];
  }
  const target = Math.min(8000, Math.max(800, Math.round((srcBitrateKbps ?? 2500) * 0.85)));
  return ['-b:v', `${target}k`];
}

/** 音频码率：按编码器给一个合理值 */
export function audioBitrateFor(encoder: string): string {
  switch (encoder) {
    case 'aac':
      return '192k';
    case 'libmp3lame':
    case 'mp3':
      return '192k';
    case 'libopus':
      return '128k';
    case 'wmav2':
      return '192k';
    case 'mp2':
      return '192k';
    case 'ac3':
      return '192k';
    default:
      return '192k';
  }
}
