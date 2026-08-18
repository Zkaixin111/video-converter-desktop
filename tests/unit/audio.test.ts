/**
 * 音频提取的参数与体积估算（TODO-20）。
 *
 * 音频这条线最容易错的是**体积估算**：它不看源体积，只看「时长 × 码率」。
 * 而磁盘预检（TODO-03）直接拿这个数去拦「空间不够」，
 * 算小了就会在转码中途写满盘——前面几个文件全白转。所以这里按「不低估」钉死。
 */
import { describe, expect, it } from 'vitest';
import {
  AUDIO_FORMATS,
  AUDIO_ORDER,
  audioBitrateFor,
  estimateAudioBytes,
  isAudioFormat,
  parseBitrateKbps,
} from '../../src/shared/audio';

describe('AUDIO_FORMATS · 定义自洽', () => {
  it('只有 mp3 / m4a 两项，且顺序与 AUDIO_ORDER 一致', () => {
    expect(AUDIO_ORDER).toEqual(['mp3', 'm4a']);
    expect(Object.keys(AUDIO_FORMATS).sort()).toEqual(['m4a', 'mp3']);
  });

  it('扩展名都带点、muxer 都不为空', () => {
    for (const key of AUDIO_ORDER) {
      const spec = AUDIO_FORMATS[key];
      expect(spec.ext.startsWith('.')).toBe(true);
      expect(spec.muxer.length).toBeGreaterThan(0);
      expect(spec.encoder.length).toBeGreaterThan(0);
      expect(spec.codecs.length).toBeGreaterThan(0);
    }
  });

  /**
   * m4a 的 muxer 必须是 mp4 而不是 ipod。
   * ipod 在精简构建的 ffmpeg 里可能被裁掉，届时「抽 m4a」会直接失败，
   * 而 mp4 muxer 在任何构建里都在，产出的文件完全一致。
   */
  it('m4a 用 mp4 muxer（ipod 在精简构建里可能不存在）', () => {
    expect(AUDIO_FORMATS.m4a.muxer).toBe('mp4');
    expect(AUDIO_FORMATS.mp3.muxer).toBe('mp3');
  });

  it('三档码率齐全且递增（高清 > 标准 > 体积优先）', () => {
    for (const key of AUDIO_ORDER) {
      const t = AUDIO_FORMATS[key].bitrate;
      expect(parseBitrateKbps(t.high)!).toBeGreaterThan(parseBitrateKbps(t.standard)!);
      expect(parseBitrateKbps(t.standard)!).toBeGreaterThan(parseBitrateKbps(t.small)!);
    }
  });
});

describe('isAudioFormat', () => {
  it('只认 mp3 / m4a', () => {
    expect(isAudioFormat('mp3')).toBe(true);
    expect(isAudioFormat('m4a')).toBe(true);
    expect(isAudioFormat('mp4')).toBe(false);
    expect(isAudioFormat('')).toBe(false);
    expect(isAudioFormat(null)).toBe(false);
    expect(isAudioFormat(undefined)).toBe(false);
    expect(isAudioFormat(1)).toBe(false);
  });

  /** 原型链上的键不算：直接用 in 判断会把 'toString' 认成合法格式 */
  it('不把原型链上的属性认作合法格式', () => {
    expect(isAudioFormat('toString')).toBe(false);
    expect(isAudioFormat('constructor')).toBe(false);
  });
});

describe('audioBitrateFor', () => {
  it('三档各自取值', () => {
    expect(audioBitrateFor('mp3', 'high')).toBe('256k');
    expect(audioBitrateFor('mp3', 'standard')).toBe('192k');
    expect(audioBitrateFor('mp3', 'small')).toBe('128k');
  });

  /** 脏档位回落 standard 而不是抛错：档位是偏好，不该让整次转换失败 */
  it('非法 / 缺失档位一律回落 standard', () => {
    expect(audioBitrateFor('mp3', undefined)).toBe('192k');
    expect(audioBitrateFor('mp3', 'ultra' as never)).toBe('192k');
    expect(audioBitrateFor('nope' as never, 'high')).toBe('192k');
  });
});

describe('parseBitrateKbps', () => {
  it('解析常规写法', () => {
    expect(parseBitrateKbps('192k')).toBe(192);
    expect(parseBitrateKbps('320K')).toBe(320);
    expect(parseBitrateKbps(' 64k ')).toBe(64);
  });

  it('解析不出来返回 null（交给调用方兜底）', () => {
    expect(parseBitrateKbps('')).toBeNull();
    expect(parseBitrateKbps('192')).toBeNull();
    expect(parseBitrateKbps('abc')).toBeNull();
    expect(parseBitrateKbps('99999k')).toBeNull();
  });
});

describe('estimateAudioBytes', () => {
  /** 3 分钟 × 192kbps ≈ 4.32 MB：这是音频里唯一能算得很准的一类体积 */
  it('时长 × 码率，与视频那套「源体积 × 系数」不同', () => {
    const bytes = estimateAudioBytes(180, '192k');
    // 180 * 192 * 125 = 4,320,000，再留 2% 封装余量
    expect(bytes).toBe(Math.ceil(180 * 192 * 125 * 1.02));
    expect(bytes).toBeGreaterThan(4_320_000);
    expect(bytes).toBeLessThan(4_500_000);
  });

  it('码率翻倍 → 体积翻倍', () => {
    const a = estimateAudioBytes(120, '128k');
    const b = estimateAudioBytes(120, '256k');
    expect(b).toBe(a * 2);
  });

  it('非法码率按 192k 兜底，不返回 0（否则磁盘预检会误判为「不占空间」）', () => {
    expect(estimateAudioBytes(60, 'abc')).toBe(estimateAudioBytes(60, '192k'));
  });

  it('时长为 0 / 负数时按 0 算，不产生负体积', () => {
    expect(estimateAudioBytes(0, '192k')).toBe(0);
    expect(estimateAudioBytes(-100, '192k')).toBe(0);
  });
});
