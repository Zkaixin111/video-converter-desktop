/**
 * 容器兼容矩阵 —— 全部业务判定的数据基础。
 *
 * 写成数据，不写成 if：新增一个容器只需要在这里加一项，
 * planner / UI / 测试会自动跟着走。
 *
 * ⚠️ `defaultVideo` 必须在该容器的 `videoCodecs` 白名单内，
 *    `defaultAudio` 同理（由 containers.test.ts 守护）。
 */
import type { ContainerKey, PresetTier, QualityOverrides, QualitySpec } from './types';

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
    // ⚠️ 这里**故意不含 h264**。
    // AVI 需要 Annex-B 起始码，而 MP4/MKV 里的 H.264 是 AVCC 格式，
    // 直接 `-c:v copy` 进 AVI 会被 muxer 拒绝：
    //   "h264 bitstream malformed, no startcode found ... Invalid data found when processing input"
    // 理论上加 `-bsf:v h264_mp4toannexb` 能塞进去，但产出的 AVI 老设备基本放不了——
    // 而「能被老设备播放」正是 AVI 在这个产品里唯一的存在理由。
    // 所以一律重编码成 mpeg4（DivX 系兼容性最好）。
    videoCodecs: ['mpeg4', 'mpeg2video', 'mpeg1video', 'wmv2', 'wmv3'],
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
 * 画质档位 → 编码参数。
 *
 * 三档的语义来自参数预设页（原型 §页面三）：
 *   high 高清优先 / standard 标准 / small 体积优先
 *
 * ⚠️ `standard` 的数值必须与 MVP 完全一致（CRF 20 / 24、码率 0.85×、音频 192k）。
 * 这是「升级不改变老用户产出」的硬约束，由 tests/unit/containers.test.ts 钉死。
 */
export type QualityTier = PresetTier;

/** CRF：x264 与其它编码器的感知曲线不同，分开给值；数值越小画质越好 */
export const CRF_BY_TIER: Record<QualityTier, { x264: number; other: number }> = {
  high: { x264: 18, other: 22 },
  standard: { x264: 20, other: 24 },
  small: { x264: 26, other: 30 },
};

/** 码率模式下相对源码率的系数（码率模式没有 CRF 可调，只能缩放目标码率） */
export const BITRATE_FACTOR_BY_TIER: Record<QualityTier, number> = {
  high: 1.15,
  standard: 0.85,
  small: 0.45,
};

/**
 * 音频码率按「档位 × 编码器」给。opus 效率高于 AAC/MP3，同档位用更低的数值。
 * 表里没有的编码器回落到该档位的 AAC 值（历史上的兜底行为保持不变）。
 */
const AUDIO_BITRATE_BY_TIER: Record<QualityTier, Record<string, string>> = {
  high: {
    aac: '256k',
    libmp3lame: '256k',
    mp3: '256k',
    libopus: '160k',
    wmav2: '256k',
    mp2: '256k',
    ac3: '256k',
  },
  standard: {
    aac: '192k',
    libmp3lame: '192k',
    mp3: '192k',
    libopus: '128k',
    wmav2: '192k',
    mp2: '192k',
    ac3: '192k',
  },
  small: {
    aac: '96k',
    libmp3lame: '96k',
    mp3: '96k',
    libopus: '64k',
    wmav2: '96k',
    mp2: '128k',
    ac3: '128k',
  },
};

export function isPresetTier(v: unknown): v is QualityTier {
  return v === 'high' || v === 'standard' || v === 'small';
}

/**
 * 视频质量参数。
 * - CRF 模式：按档位取值，VP9 必须配 `-b:v 0` 才是纯 CRF
 * - 码率模式：不超过「源码率 × 档位系数」，钳在 800k~8000k
 *
 * `tier` 缺省为 `standard`，与 MVP 行为逐字节一致。
 */
export function buildVideoQualityArgs(
  encoder: string,
  srcBitrateKbps: number | null,
  tier: QualityTier = 'standard',
): string[] {
  if (CRF_ENCODERS.has(encoder)) {
    const crf = CRF_BY_TIER[tier][encoder === 'libx264' ? 'x264' : 'other'];
    const extra = encoder === 'libvpx-vp9' ? ['-b:v', '0'] : [];
    return ['-crf', String(crf), ...extra];
  }
  const factor = BITRATE_FACTOR_BY_TIER[tier];
  const target = Math.min(8000, Math.max(800, Math.round((srcBitrateKbps ?? 2500) * factor)));
  return ['-b:v', `${target}k`];
}

/** 音频码率：按「档位 × 编码器」取值，未知编码器回落到该档位的 AAC 值 */
export function audioBitrateFor(encoder: string, tier: QualityTier = 'standard'): string {
  const table = AUDIO_BITRATE_BY_TIER[tier];
  return table[encoder] ?? table.aac;
}

/* ──────────────────────────────────────────────────────────
 * 精细调节（手动画质参数）
 *
 * 放在这里而不是 planner 里，是为了让「填了非法值会怎样」能被单测覆盖——
 * 这类 "在 UI 上看起来保存成功、实际被悄悄改掉" 的逻辑最容易变成 bug 温床。
 * ────────────────────────────────────────────────────────── */

/** 支持 CRF 范围的编码器（x264/x265 上限 51，VP9/AV1 上限 63） */
const CRF_MAX: Record<string, number> = { libx264: 51, libx265: 51, 'libvpx-vp9': 63, libsvtav1: 63 };

/** 认 `-preset` 的编码器：只有这两家，别的传了会直接报错 */
const SPEED_ENCODERS = new Set(['libx264', 'libx265']);

export const SPEED_PRESETS = [
  'ultrafast',
  'veryfast',
  'fast',
  'medium',
  'slow',
  'veryslow',
] as const;

/** 精细调节里可选的编码器：必须是「容器认它的产物」且在本机 ffmpeg 里常见 */
export const ENCODER_CHOICES = [
  'libx264',
  'libx265',
  'libvpx-vp9',
  'mpeg4',
  'mpeg2video',
  'wmv2',
] as const;

const AUDIO_BITRATE_RE = /^\d{1,4}k$/;

export interface ResolveQualityInput {
  /** 容器默认视频编码器 */
  defaultEncoder: string;
  /** 容器默认音频编码器（决定音频码率取值区间） */
  defaultAudio: string;
  /** 该容器接受的 codec_name 列表（决定自定义编码器能不能用） */
  videoCodecs: string[];
  srcBitrateKbps: number | null;
  tier: QualityTier;
  overrides?: unknown;
}

/**
 * 档位 + 手工参数 → 最终编码参数。
 *
 * 四条处理原则：
 *   1. 没给 overrides（或没启用）→ 结果与三档完全一致
 *   2. 越界数值被**钳住而不是报错**，并把改了什么写进 notes —— UI 要把这件事说清楚
 *   3. 容器不支持所选编码器 → 回落默认编码器，同样留一条 note
 *   4. CRF 与码率互斥：**给了 CRF 就按 CRF**（并用 notes 说明码率被忽略）
 */
export function resolveQuality(input: ResolveQualityInput): QualitySpec {
  const { defaultEncoder, defaultAudio, videoCodecs, srcBitrateKbps, tier } = input;
  const raw = (input.overrides ?? null) as QualityOverrides | null;
  const ov = raw && raw.enabled ? raw : null;
  const notes: string[] = [];

  /* 编码器 */
  let encoder = defaultEncoder;
  if (ov?.videoEncoder) {
    const wanted = ov.videoEncoder;
    const produced = ENCODER_CODEC[wanted] ?? wanted;
    if (videoCodecs.includes(produced)) {
      encoder = wanted;
    } else {
      notes.push(`该格式不支持 ${wanted}，已改用默认编码器 ${defaultEncoder}`);
    }
  }

  /* 视频码率 / CRF */
  let crf: number | null = null;
  let bitrateKbps: number | null = null;
  if (CRF_ENCODERS.has(encoder)) {
    if (typeof ov?.crf === 'number' && Number.isFinite(ov.crf)) {
      const max = CRF_MAX[encoder] ?? 51;
      const wanted = Math.round(ov.crf);
      crf = Math.min(max, Math.max(0, wanted));
      if (crf !== wanted) notes.push(`CRF 已钳到合法区间 0–${max}（原值 ${wanted}）`);
      if (typeof ov?.videoBitrateKbps === 'number') notes.push('目标码率在 CRF 编码下不生效，已忽略');
    } else {
      // 与 buildVideoQualityArgs 保持同一分支，保证档位行为不变
      crf = CRF_BY_TIER[tier][encoder === 'libx264' ? 'x264' : 'other'];
    }
  } else {
    if (typeof ov?.videoBitrateKbps === 'number' && Number.isFinite(ov.videoBitrateKbps)) {
      const wanted = Math.round(ov.videoBitrateKbps);
      bitrateKbps = Math.min(50000, Math.max(100, wanted));
      if (bitrateKbps !== wanted) notes.push(`目标码率已钳到 100–50000k（原值 ${wanted}）`);
    } else {
      const factor = BITRATE_FACTOR_BY_TIER[tier];
      bitrateKbps = Math.min(8000, Math.max(800, Math.round((srcBitrateKbps ?? 2500) * factor)));
    }
  }

  /* 音频码率：按容器的默认音频编码器取值 */
  let audioBitrate = audioBitrateFor(defaultAudio, tier);
  if (typeof ov?.audioBitrate === 'string' && AUDIO_BITRATE_RE.test(ov.audioBitrate)) {
    audioBitrate = ov.audioBitrate;
  } else if (ov?.audioBitrate) {
    notes.push('音频码率格式应为 128k 这样的写法，已按档位取值');
  }

  /* 编码速度 */
  let speedPreset: string | null = null;
  if (SPEED_ENCODERS.has(encoder)) {
    const wanted = typeof ov?.speed === 'string' ? ov.speed : 'veryfast';
    speedPreset = SPEED_PRESETS.includes(wanted as (typeof SPEED_PRESETS)[number])
      ? wanted
      : 'veryfast';
    if (typeof ov?.speed === 'string' && speedPreset !== ov.speed) {
      notes.push('编码速度取值无效，已回落到 veryfast');
    }
  } else if (ov?.speed) {
    notes.push(`${encoder} 不支持调节编码速度，该设置被忽略`);
  }

  return { encoder, crf, bitrateKbps, audioBitrate, speedPreset, notes };
}
