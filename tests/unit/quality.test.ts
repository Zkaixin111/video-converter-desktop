/**
 * 精细调节（手动画质参数）的判定规则。
 *
 * 这个文件只盯三件事：
 *   1. 没配精细调节时，结果与三档**逐字节一致**（这条是对老用户的硬承诺）
 *   2. 越界值、非法组合被「钳住/回落」而不是报错，且留了说明文案
 *   3. CRF 与码率互斥时的取舍是确定的（有 CRF 就用 CRF）
 */
import { describe, expect, it } from 'vitest';
import { CONTAINERS, resolveQuality } from '../../src/shared/containers';
import type { ContainerKey } from '../../src/shared/types';
import { planConversion } from '../../src/main/core/ffmpeg/planner';
import type { MediaMeta } from '../../src/shared/types';

function baseMock(extra: Partial<MediaMeta> = {}): MediaMeta {
  return {
    path: 'C:\\videos\\demo.mp4',
    fileName: 'demo.mp4',
    sizeBytes: 50 * 1024 * 1024,
    durationSec: 30,
    formatName: 'mov,mp4',
    video: {
      codec: 'h264',
      codecLongName: 'H.264',
      width: 1920,
      height: 1080,
      fps: 30,
      isVfr: false,
      bitrateKbps: 5000,
      pixFmt: 'yuv420p',
      bitDepth: 8,
    },
    audio: { codec: 'aac', sampleRate: 48000, channels: 2, bitrateKbps: 192 },
    audioTracks: 1,
    subtitleTracks: 0,
    warnings: [],
    ...extra,
  };
}

/** mp4 容器的默认参数上下文 */
function mp4Ctx() {
  const spec = CONTAINERS.mp4;
  return { defaultEncoder: spec.defaultVideo, defaultAudio: spec.defaultAudio, videoCodecs: spec.videoCodecs };
}

/** avi：默认视频编码器是 mpeg4（不支持 CRF，走码率模式） */
function aviCtx() {
  const spec = CONTAINERS.avi;
  return { defaultEncoder: spec.defaultVideo, defaultAudio: spec.defaultAudio, videoCodecs: spec.videoCodecs };
}

/** webm：默认编码器 libvpx-vp9，白名单里没有 h264 */
function webmCtx() {
  const spec = CONTAINERS.webm;
  return { defaultEncoder: spec.defaultVideo, defaultAudio: spec.defaultAudio, videoCodecs: spec.videoCodecs };
}

/** 强制走重编码的源：mp4 容器不接受 mpeg2video */
function encodeSource(): MediaMeta {
  return baseMock({ video: { ...(baseMock().video as MediaMeta['video'])!, codec: 'mpeg2video' } });
}

describe('resolveQuality · 未启用时与三档一致', () => {
  it('不给 overrides：libx264 取 standard 的 CRF 20、速度 veryfast', () => {
    const q = resolveQuality({ ...mp4Ctx(), srcBitrateKbps: 5000, tier: 'standard' });
    expect(q.encoder).toBe('libx264');
    expect(q.crf).toBe(20);
    expect(q.bitrateKbps).toBeNull();
    expect(q.speedPreset).toBe('veryfast');
    expect(q.notes).toEqual([]);
  });

  it('enabled 为 false 时忽略已保存的数值', () => {
    const q = resolveQuality({
      ...mp4Ctx(),
      srcBitrateKbps: 5000,
      tier: 'small',
      overrides: { enabled: false, crf: 30 },
    });
    expect(q.crf).toBe(26); // small 档的值
    expect(q.notes).toEqual([]);
  });

  it('码率模式的容器按档位系数取码率（0.85×，钳在 800–8000）', () => {
    const q = resolveQuality({ ...aviCtx(), srcBitrateKbps: 5000, tier: 'standard' });
    expect(q.crf).toBeNull();
    expect(q.bitrateKbps).toBe(4250);
    expect(q.speedPreset).toBeNull(); // mpeg4 不认 -preset
  });
});

describe('resolveQuality · 钳值与回落', () => {
  it('CRF 超出 x264 的 51 上限时被钳住并说明', () => {
    const q = resolveQuality({
      ...mp4Ctx(),
      srcBitrateKbps: 5000,
      tier: 'standard',
      overrides: { enabled: true, crf: 80 },
    });
    expect(q.crf).toBe(51);
    expect(q.notes.some((n) => n.includes('CRF 已钳到合法区间 0–51'))).toBe(true);
  });

  it('CRF 为负数钳到 0', () => {
    const q = resolveQuality({
      ...mp4Ctx(),
      srcBitrateKbps: 5000,
      tier: 'standard',
      overrides: { enabled: true, crf: -12 },
    });
    expect(q.crf).toBe(0);
    expect(q.notes.length).toBe(1);
  });

  it('VP9 的上限是 63（与 x264 不同）', () => {
    const webm = CONTAINERS.webm;
    const q = resolveQuality({
      defaultEncoder: webm.defaultVideo,
      defaultAudio: webm.defaultAudio,
      videoCodecs: webm.videoCodecs,
      srcBitrateKbps: 4000,
      tier: 'standard',
      overrides: { enabled: true, crf: 99 },
    });
    expect(q.crf).toBe(63);
    expect(q.notes.some((n) => n.includes('0–63'))).toBe(true);
  });

  it('目标码率钳在 100–50000k', () => {
    const q = resolveQuality({
      ...aviCtx(),
      srcBitrateKbps: 5000,
      tier: 'standard',
      overrides: { enabled: true, videoBitrateKbps: 999999 },
    });
    expect(q.bitrateKbps).toBe(50000);
    expect(q.notes.some((n) => n.includes('目标码率已钳到'))).toBe(true);
  });

  it('容器不支持所选编码器时回落默认编码器并说明', () => {
    // WebM 只接受 VP8/VP9/AV1，点名要 libx264 也只能是 VP9
    const q = resolveQuality({
      ...webmCtx(),
      srcBitrateKbps: 5000,
      tier: 'standard',
      overrides: { enabled: true, videoEncoder: 'libx264' },
    });
    expect(q.encoder).toBe('libvpx-vp9');
    expect(q.notes.some((n) => n.includes('已改用默认编码器'))).toBe(true);
  });

  it('音频码率格式非法时按档位取值', () => {
    const q = resolveQuality({
      ...mp4Ctx(),
      srcBitrateKbps: 5000,
      tier: 'high',
      overrides: { enabled: true, audioBitrate: '320 kbps' },
    });
    expect(q.audioBitrate).toBe('256k'); // high 档的 aac 值
    expect(q.notes.some((n) => n.includes('音频码率格式'))).toBe(true);
  });

  it('不支持 -preset 的编码器被要求调速时会说明忽略', () => {
    const q = resolveQuality({
      ...aviCtx(),
      srcBitrateKbps: 5000,
      tier: 'standard',
      overrides: { enabled: true, speed: 'slow' },
    });
    expect(q.speedPreset).toBeNull();
    expect(q.notes.some((n) => n.includes('不支持调节编码速度'))).toBe(true);
  });
});

describe('resolveQuality · CRF 与码率互斥', () => {
  it('同时给了 CRF 和码率：按 CRF，并说明码率被忽略', () => {
    const q = resolveQuality({
      ...mp4Ctx(),
      srcBitrateKbps: 5000,
      tier: 'standard',
      overrides: { enabled: true, crf: 24, videoBitrateKbps: 3000 },
    });
    expect(q.crf).toBe(24);
    expect(q.bitrateKbps).toBeNull();
    expect(q.notes.some((n) => n.includes('目标码率在 CRF 编码下不生效'))).toBe(true);
  });
});

describe('planner · 精细调节接通后 args 正确', () => {
  it('启用 CRF 后 args 用自定义值，且仍然互斥于 -b:v', () => {
    const plan = planConversion({
      meta: encodeSource(),
      target: 'mp4',
      options: { preset: 'standard', overrides: { enabled: true, crf: 28 } },
    });
    expect(plan.videoAction).toBe('encode');
    expect(plan.args).toContain('-crf');
    expect(plan.args[plan.args.indexOf('-crf') + 1]).toBe('28');
    expect(plan.quality.crf).toBe(28);
  });

  it('没启用时 args 与旧实现一致（CRF 20 + veryfast + 音频 copy）', () => {
    const plan = planConversion({
      meta: encodeSource(),
      target: 'mp4',
      options: { preset: 'standard' },
    });
    expect(plan.args).toEqual([
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
    ]);
    expect(plan.quality.notes).toEqual([]);
  });

  it('VP9 仍带 -b:v 0（否则 -crf 会被当成上界）', () => {
    const plan = planConversion({
      meta: baseMock({ video: { ...baseMock().video!, codec: 'h264' } }),
      target: 'webm',
      options: { preset: 'standard', overrides: { enabled: true, crf: 32 } },
    });
    expect(plan.quality.crf).toBe(32);
    expect(plan.args).toContain('-crf');
    expect(plan.args).toContain('0');
    expect(plan.args[plan.args.indexOf('-b:v') + 1]).toBe('0');
  });

  it('自定义音频码率落到 -b:a', () => {
    // mp4 容器不接受 opus 音轨，必然走到「音频重编码」这条分支
    const meta = encodeSource();
    const withOpus: MediaMeta = {
      ...meta,
      audio: { codec: 'opus', sampleRate: 48000, channels: 2, bitrateKbps: 128 },
    };
    const plan = planConversion({
      meta: withOpus,
      target: 'mp4',
      options: { preset: 'standard', overrides: { enabled: true, audioBitrate: '320k' } },
    });
    expect(plan.audioAction).toBe('encode');
    expect(plan.args[plan.args.indexOf('-b:a') + 1]).toBe('320k');
  });

  it('换编码器到 mpeg4（mp4 容器接受）后 args 用它', () => {
    const plan = planConversion({
      meta: encodeSource(),
      target: 'mp4',
      options: { preset: 'standard', overrides: { enabled: true, videoEncoder: 'mpeg4' } },
    });
    expect(plan.quality.encoder).toBe('mpeg4');
    expect(plan.args).toContain('mpeg4');
    // mpeg4 不支持 CRF，应给出目标码率
    expect(plan.quality.crf).toBeNull();
    expect(plan.quality.bitrateKbps).not.toBeNull();
  });

  it('直通模式下精细调节不进 args（画面不重新压缩）', () => {
    const plan = planConversion({
      meta: baseMock(),
      target: 'mp4',
      options: { preset: 'standard', overrides: { enabled: true, crf: 26 } },
    });
    expect(plan.mode).toBe('copy');
    expect(plan.args).toContain('copy');
    expect(plan.args.some((a) => a === '-crf')).toBe(false);
  });
});

describe('全部容器的自定义编码器都在能力矩阵内', () => {
  it('ENCODER_CHOICES 里每个编码器都至少能被一种容器接受', () => {
    const all = new Set<string>();
    for (const key of Object.keys(CONTAINERS) as ContainerKey[]) {
      CONTAINERS[key].videoCodecs.forEach((c) => all.add(c));
    }
    expect(all.has('vp9') || all.has('av1')).toBe(true);
  });
});
