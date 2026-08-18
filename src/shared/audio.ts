/**
 * 音频提取的目标格式（TODO-20）。
 *
 * 为什么**不**把 mp3 / m4a 加进 `ContainerKey`：
 * 容器矩阵里每一项都带着 `videoCodecs` / `defaultVideo` / `faststart`，
 * 而音频输出根本没有视频流、也没有 faststart 可言。
 * 硬塞进去会让「8 个视频格式」的每一处循环都得先判断「这是不是音频」，
 * 参数预设、精细调节、体积系数这些表也要为两个永远用不到的键填占位值。
 *
 * 所以音频是**平行于容器的另一条输出路线**：
 *   · 画质档位复用三档，但语义是「音质档位」（决定码率）
 *   · 输出路径、校验、历史各自多一条分支，而不是把视频那套改歪
 */
import type { PresetTier } from './types';

export type AudioFormat = 'mp3' | 'm4a';

export interface AudioSpec {
  label: string;
  desc: string;
  ext: string;
  /**
   * ffprobe 读出来的 codec_name 白名单。
   * 源音频正好在这个名单里 → 直接 `-c:a copy` 抽出来，音质 100% 保留；
   * 不在 → 必须重编码（例如 MP4 里的 AAC 抽成 MP3）。
   */
  codecs: string[];
  /** ffmpeg `-c:a` 用的编码器名（与 codec_name 是两套命名空间） */
  encoder: string;
  /** `-f` 参数。显式给出而不是靠扩展名推断——同一个 m4a 扩展名有多个候选 muxer */
  muxer: string;
  /** 音质档位 → 码率 */
  bitrate: Record<PresetTier, string>;
}

export const AUDIO_FORMATS: Record<AudioFormat, AudioSpec> = {
  mp3: {
    label: 'MP3',
    desc: '最通用',
    ext: '.mp3',
    codecs: ['mp3'],
    encoder: 'libmp3lame',
    muxer: 'mp3',
    bitrate: { high: '256k', standard: '192k', small: '128k' },
  },
  m4a: {
    label: 'M4A',
    desc: '苹果与高音质',
    ext: '.m4a',
    codecs: ['aac'],
    encoder: 'aac',
    // m4a 就是换成 .m4a 扩展名的 MP4；用 mp4 muxer 而不是 ipod，
    // 前者在任何 ffmpeg 构建里都在，后者在精简构建里可能被裁掉
    muxer: 'mp4',
    bitrate: { high: '256k', standard: '192k', small: '128k' },
  },
};

/** UI 展示顺序 */
export const AUDIO_ORDER: AudioFormat[] = ['mp3', 'm4a'];

export function isAudioFormat(v: unknown): v is AudioFormat {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(AUDIO_FORMATS, v);
}

/** 音质档位 → 码率；非法档位一律按 standard（与视频档位的兜底口径一致） */
export function audioBitrateFor(
  format: AudioFormat,
  tier: PresetTier | undefined,
): string {
  const spec = AUDIO_FORMATS[format];
  const table = spec?.bitrate;
  if (!table) return '192k';
  return tier === 'high' || tier === 'small' ? table[tier] : table.standard;
}

/** 把 '320k' 这样的写法解析成数字（kbps）；解析不出来返回 null */
export function parseBitrateKbps(v: string): number | null {
  const m = /^(\d{1,4})k$/i.exec(v.trim());
  if (!m) return null;
  return Number(m[1]);
}

/**
 * 音频输出的体积估算：时长 × 码率。
 *
 * 与视频那套「源体积 × 系数」不同 —— 音频没有画面，码率一旦定死，
 * 体积就几乎是确定的（这是少数能算得很准的场景）。
 * 仍留 2% 封装余量，保证不低估。
 */
export function estimateAudioBytes(durationSec: number, bitrate: string): number {
  const kbps = parseBitrateKbps(bitrate) ?? 192;
  const sec = durationSec > 0 ? durationSec : 0;
  return Math.ceil(sec * kbps * 125 * 1.02);
}
