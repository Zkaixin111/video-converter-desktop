/**
 * planner 单元测试 —— 全项目最重要的测试。
 *
 * 它守的是「兼容矩阵」这一件事：同一个源文件，目标容器不同，
 * 到底该直通、还是只转音频、还是全量重编码。判错了要么画质白掉，
 * 要么转一半失败，而且都在用户侧才暴露。
 *
 * 覆盖三个维度：8 个容器的判定 × 4 类源文件 × 参数组装细节。
 */
import { describe, expect, it } from 'vitest';
import { planConversion } from '../../src/main/core/ffmpeg/planner';
import { AppError } from '../../src/shared/errors';
import type { ContainerKey } from '../../src/shared/types';
import { makeAudio, makeMeta, makeVideo } from '../helpers/meta';

/** 断言抛出的错误码 */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`预期抛出 ${code}，但函数正常返回了`);
}

describe('planConversion · 前置校验', () => {
  it('目标格式不在白名单内 → E_UNSUPPORTED_TARGET', () => {
    expectCode(
      () => planConversion({ meta: makeMeta(), target: '3gp' as ContainerKey }),
      'E_UNSUPPORTED_TARGET',
    );
  });

  it('没有视频流 → E_NO_VIDEO_STREAM，并给出下一步建议', () => {
    try {
      planConversion({ meta: makeMeta({ video: null }), target: 'mp4' });
      throw new Error('应当抛错');
    } catch (err) {
      expect((err as AppError).code).toBe('E_NO_VIDEO_STREAM');
      expect((err as AppError).hint).toBeTruthy();
    }
  });
});

describe('planConversion · 判定矩阵', () => {
  const cases: {
    name: string;
    video: string;
    audio: string | null;
    target: ContainerKey;
    mode: string;
    videoAction: string;
    audioAction: string;
  }[] = [
    // ── 无损直通：画面与声音都能直接装进新容器 ──
    { name: 'h264+aac → mp4', video: 'h264', audio: 'aac', target: 'mp4', mode: 'copy', videoAction: 'copy', audioAction: 'copy' },
    { name: 'hevc+aac → mp4', video: 'hevc', audio: 'aac', target: 'mp4', mode: 'copy', videoAction: 'copy', audioAction: 'copy' },
    { name: 'h264+aac → mkv', video: 'h264', audio: 'aac', target: 'mkv', mode: 'copy', videoAction: 'copy', audioAction: 'copy' },
    { name: 'h264+opus → mkv（mkv 什么音频都能装）', video: 'h264', audio: 'opus', target: 'mkv', mode: 'copy', videoAction: 'copy', audioAction: 'copy' },
    { name: 'h264+aac → mov', video: 'h264', audio: 'aac', target: 'mov', mode: 'copy', videoAction: 'copy', audioAction: 'copy' },
    { name: 'h264+aac → flv', video: 'h264', audio: 'aac', target: 'flv', mode: 'copy', videoAction: 'copy', audioAction: 'copy' },
    { name: 'wmv2+wmav2 → wmv', video: 'wmv2', audio: 'wmav2', target: 'wmv', mode: 'copy', videoAction: 'copy', audioAction: 'copy' },
    { name: 'vp9+opus → webm', video: 'vp9', audio: 'opus', target: 'webm', mode: 'copy', videoAction: 'copy', audioAction: 'copy' },
    { name: 'mpeg2video+mp2 → mpeg', video: 'mpeg2video', audio: 'mp2', target: 'mpeg', mode: 'copy', videoAction: 'copy', audioAction: 'copy' },

    // ── 混合直通：画面不动，音频要重编码 ──
    { name: 'h264+opus → mp4（mp4 装不下 opus）', video: 'h264', audio: 'opus', target: 'mp4', mode: 'remux', videoAction: 'copy', audioAction: 'encode' },
    { name: 'h264+vorbis → flv', video: 'h264', audio: 'vorbis', target: 'flv', mode: 'remux', videoAction: 'copy', audioAction: 'encode' },
    { name: 'hevc+truehd → mov', video: 'hevc', audio: 'truehd', target: 'mov', mode: 'remux', videoAction: 'copy', audioAction: 'encode' },

    // ── 全量重编码：画面装不下，音频顺带一起做 ──
    { name: 'h264 → webm', video: 'h264', audio: 'aac', target: 'webm', mode: 'transcode', videoAction: 'encode', audioAction: 'encode' },
    // AVI 不收 H.264（AVCC 与 AVI 的 Annex-B 不兼容，见 containers.ts 注释），必须重编码
    { name: 'h264+aac → avi', video: 'h264', audio: 'aac', target: 'avi', mode: 'transcode', videoAction: 'encode', audioAction: 'encode' },
    { name: 'mpeg4+mp3 → avi（老编码直通）', video: 'mpeg4', audio: 'mp3', target: 'avi', mode: 'copy', videoAction: 'copy', audioAction: 'copy' },
    { name: 'h264 → wmv', video: 'h264', audio: 'aac', target: 'wmv', mode: 'transcode', videoAction: 'encode', audioAction: 'encode' },
    { name: 'h264 → mpeg', video: 'h264', audio: 'aac', target: 'mpeg', mode: 'transcode', videoAction: 'encode', audioAction: 'encode' },
    { name: 'hevc → avi（avi 不收 hevc）', video: 'hevc', audio: 'aac', target: 'avi', mode: 'transcode', videoAction: 'encode', audioAction: 'encode' },
    { name: 'vp9 → mpeg', video: 'vp9', audio: 'aac', target: 'mpeg', mode: 'transcode', videoAction: 'encode', audioAction: 'encode' },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const meta = makeMeta({
        video: makeVideo({ codec: c.video }),
        audio: c.audio ? makeAudio({ codec: c.audio }) : null,
        audioTracks: c.audio ? 1 : 0,
      });
      const plan = planConversion({ meta, target: c.target });
      expect(plan.mode).toBe(c.mode);
      expect(plan.videoAction).toBe(c.videoAction);
      expect(plan.audioAction).toBe(c.audioAction);
    });
  }
});

describe('planConversion · 无音轨', () => {
  it('无音轨 → audioAction 为 none，模式仍可为 copy', () => {
    const plan = planConversion({
      meta: makeMeta({ audio: null, audioTracks: 0 }),
      target: 'mp4',
    });
    expect(plan.mode).toBe('copy');
    expect(plan.audioAction).toBe('none');
  });

  it('无音轨时不得出现 -c:a', () => {
    const plan = planConversion({ meta: makeMeta({ audio: null }), target: 'webm' });
    expect(plan.args).not.toContain('-c:a');
  });

  it('无音轨要给出 NO_AUDIO 警告', () => {
    const plan = planConversion({ meta: makeMeta({ audio: null }), target: 'mp4' });
    expect(plan.warnings.map((w) => w.code)).toContain('NO_AUDIO');
  });

  it('音频流映射必须带问号（0:a:0?），否则纯视频文件直接失败', () => {
    const plan = planConversion({ meta: makeMeta(), target: 'mp4' });
    expect(plan.args).toContain('0:a:0?');
  });
});

describe('planConversion · 参数组装', () => {
  it('直通时只出现 -c:v copy / -c:a copy，不得出现任何编码参数', () => {
    const plan = planConversion({ meta: makeMeta(), target: 'mp4' });
    expect(plan.args).toEqual(
      expect.arrayContaining(['-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart']),
    );
    expect(plan.args).not.toContain('-crf');
    expect(plan.args).not.toContain('-preset');
    expect(plan.args).not.toContain('-pix_fmt');
  });

  it('只有 MP4 / MOV 才加 -movflags +faststart', () => {
    expect(planConversion({ meta: makeMeta(), target: 'mp4' }).args).toContain('+faststart');
    expect(planConversion({ meta: makeMeta(), target: 'mov' }).args).toContain('+faststart');
    expect(planConversion({ meta: makeMeta(), target: 'mkv' }).args).not.toContain('+faststart');
    expect(planConversion({ meta: makeMeta(), target: 'avi' }).args).not.toContain('+faststart');
  });

  it('重编码到 mp4 用 libx264 + veryfast + crf20 + yuv420p', () => {
    // prores 只被 MOV 接受，转 MP4 必然重编码
    const plan = planConversion({ meta: makeMeta({ video: makeVideo({ codec: 'prores' }) }), target: 'mp4' });
    expect(plan.args).toEqual(
      expect.arrayContaining(['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p']),
    );
  });

  it('重编码到 webm 用 libvpx-vp9，且必须带 -b:v 0 才是纯 CRF 模式', () => {
    const plan = planConversion({ meta: makeMeta(), target: 'webm' });
    expect(plan.args).toEqual(
      expect.arrayContaining(['-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-c:a', 'libopus']),
    );
  });

  it('不支持 CRF 的编码器必须给目标码率，不得出现 -crf', () => {
    const plan = planConversion({ meta: makeMeta({ video: makeVideo({ codec: 'hevc' }) }), target: 'avi' });
    expect(plan.args).toContain('-c:v');
    expect(plan.args).toContain('mpeg4');
    expect(plan.args).toContain('-b:v');
    expect(plan.args).not.toContain('-crf');
    // mpeg4 是码率模式，preset 传了会报错
    expect(plan.args).not.toContain('-preset');
  });

  it('码率模式的目标码率不超过源码率的 85%，且有上下限', () => {
    const low = planConversion({
      meta: makeMeta({ video: makeVideo({ codec: 'hevc', bitrateKbps: 400 }) }),
      target: 'avi',
    });
    const lowIdx = low.args.indexOf('-b:v');
    expect(low.args[lowIdx + 1]).toBe('800k');

    const high = planConversion({
      meta: makeMeta({ video: makeVideo({ codec: 'hevc', bitrateKbps: 40000 }) }),
      target: 'avi',
    });
    const highIdx = high.args.indexOf('-b:v');
    expect(high.args[highIdx + 1]).toBe('8000k');

    const mid = planConversion({
      meta: makeMeta({ video: makeVideo({ codec: 'hevc', bitrateKbps: 2000 }) }),
      target: 'avi',
    });
    const midIdx = mid.args.indexOf('-b:v');
    expect(mid.args[midIdx + 1]).toBe('1700k');
  });

  it('音频重编码按编码器给码率（opus 128k、aac 192k）', () => {
    const webm = planConversion({ meta: makeMeta(), target: 'webm' });
    const wi = webm.args.indexOf('-b:a');
    expect(webm.args[wi + 1]).toBe('128k');

    const mp4 = planConversion({ meta: makeMeta({ audio: makeAudio({ codec: 'opus' }) }), target: 'mp4' });
    const mi = mp4.args.indexOf('-b:a');
    expect(mp4.args[mi + 1]).toBe('192k');
  });

  it('args 里不得出现路径、输入输出文件、-progress（那是 runner 的职责）', () => {
    const plan = planConversion({ meta: makeMeta(), target: 'webm' });
    for (const a of plan.args) {
      expect(a).not.toContain('C:\\');
      expect(a).not.toContain('/');
      expect(a).not.toContain('.mp4');
      expect(a).not.toBe('-i');
      expect(a).not.toBe('-y');
      expect(a).not.toBe('-progress');
    }
  });

  it('同样的输入两次规划结果完全一致（纯函数、无随机/时间依赖）', () => {
    const meta = makeMeta();
    expect(planConversion({ meta, target: 'webm' })).toEqual(planConversion({ meta, target: 'webm' }));
  });
});

describe('planConversion · 警告', () => {
  it('有字幕轨 → SUBTITLE_DROPPED', () => {
    const plan = planConversion({ meta: makeMeta({ subtitleTracks: 2 }), target: 'mp4' });
    expect(plan.warnings.map((w) => w.code)).toContain('SUBTITLE_DROPPED');
  });

  it('多音轨 → EXTRA_AUDIO_DROPPED，且提示具体条数', () => {
    const plan = planConversion({ meta: makeMeta({ audioTracks: 3 }), target: 'mp4' });
    const w = plan.warnings.find((x) => x.code === 'EXTRA_AUDIO_DROPPED');
    expect(w?.message).toContain('3');
  });

  it('VFR 源 → VFR_SOURCE', () => {
    const plan = planConversion({ meta: makeMeta({ video: makeVideo({ isVfr: true }) }), target: 'mp4' });
    expect(plan.warnings.map((w) => w.code)).toContain('VFR_SOURCE');
  });

  it('10bit 源在重编码时 → BIT_DEPTH_REDUCED', () => {
    const plan = planConversion({
      meta: makeMeta({ video: makeVideo({ codec: 'prores', bitDepth: 10 }) }),
      target: 'mp4',
    });
    expect(plan.warnings.map((w) => w.code)).toContain('BIT_DEPTH_REDUCED');
  });

  it('10bit 源在直通时不提示降位深（画面根本没动）', () => {
    const plan = planConversion({
      meta: makeMeta({ video: makeVideo({ codec: 'h264', bitDepth: 10 }) }),
      target: 'mkv',
    });
    expect(plan.warnings.map((w) => w.code)).not.toContain('BIT_DEPTH_REDUCED');
  });

  it('一切正常时不给任何警告（不要为了显得谨慎而吓唬用户）', () => {
    const plan = planConversion({ meta: makeMeta(), target: 'mp4' });
    expect(plan.warnings).toEqual([]);
  });
});

describe('planConversion · 耗时估算', () => {
  it('直通是 instant，秒级', () => {
    const plan = planConversion({ meta: makeMeta(), target: 'mp4' });
    expect(plan.estimate.kind).toBe('instant');
    expect(plan.estimate.approxSeconds).toBeLessThan(5);
    expect(plan.estimate.qualityNote).toContain('100%');
  });

  it('全量重编码按 0.5× 实时估算，且不小于 3 秒', () => {
    const plan = planConversion({ meta: makeMeta({ durationSec: 600 }), target: 'webm' });
    expect(plan.estimate.kind).toBe('encoded');
    expect(plan.estimate.approxSeconds).toBe(300);

    const tiny = planConversion({ meta: makeMeta({ durationSec: 1 }), target: 'webm' });
    expect(tiny.estimate.approxSeconds).toBe(3);
  });

  it('混合直通比全量重编码快（只转音频）', () => {
    const remux = planConversion({
      meta: makeMeta({ audio: makeAudio({ codec: 'opus' }) }),
      target: 'mp4',
    });
    const transcode = planConversion({ meta: makeMeta(), target: 'webm' });
    expect(remux.estimate.approxSeconds).toBeLessThan(transcode.estimate.approxSeconds);
  });

  it('时长为 0（探测不到）也不得算出负数或 NaN', () => {
    const plan = planConversion({ meta: makeMeta({ durationSec: 0 }), target: 'webm' });
    expect(Number.isFinite(plan.estimate.approxSeconds)).toBe(true);
    expect(plan.estimate.approxSeconds).toBeGreaterThan(0);
  });
});

/**
 * P1-03：画质档位贯通。
 *
 * 三条契约：
 *   1. 不传档位 = standard，args 与 MVP 一致（升级不改老用户产出）
 *   2. 高档位 CRF 更小、体积档 CRF 更大；直通场景完全不看档位
 *   3. 脏档位（用户手改配置文件）回落 standard，而不是抛错
 */
describe('planConversion · 画质档位（P1-03）', () => {
  it('缺省即 standard，并在结果里回填档位', () => {
    const plan = planConversion({ meta: makeMeta(), target: 'webm' });
    expect(plan.preset).toBe('standard');
    // webm 的默认编码器是 libvpx-vp9 → standard 档 CRF 24，与 MVP 一致
    expect(plan.args[plan.args.indexOf('-crf') + 1]).toBe('24');
  });

  it('high 档位把 CRF 调小、small 调大', () => {
    const high = planConversion({ meta: makeMeta(), target: 'webm', options: { preset: 'high' } });
    const small = planConversion({ meta: makeMeta(), target: 'webm', options: { preset: 'small' } });
    const crfOf = (args: string[]) => Number(args[args.indexOf('-crf') + 1]);
    expect(crfOf(high.args)).toBeLessThan(crfOf(small.args));
    expect(high.preset).toBe('high');
  });

  it('档位不影响编码器选择与像素格式', () => {
    // HEVC 源 → FLV（只认 h264），必然重编码到 libx264
    const meta = makeMeta({ video: makeVideo({ codec: 'hevc' }) });
    for (const preset of ['high', 'standard', 'small'] as const) {
      const plan = planConversion({ meta, target: 'flv', options: { preset } });
      expect(plan.mode).toBe('transcode');
      expect(plan.args).toEqual(
        expect.arrayContaining(['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p']),
      );
    }
  });

  it('直通场景换任何档位，args 都不变（不经编码器）', () => {
    const base = planConversion({ meta: makeMeta(), target: 'mp4' });
    for (const preset of ['high', 'small'] as const) {
      const plan = planConversion({ meta: makeMeta(), target: 'mp4', options: { preset } });
      expect(plan.mode).toBe('copy');
      expect(plan.args).toEqual(base.args);
    }
  });

  it('混合直通（只转音频）时档位会改变音频码率', () => {
    const meta = makeMeta({ audio: makeAudio({ codec: 'opus' }) });
    const high = planConversion({ meta, target: 'mp4', options: { preset: 'high' } });
    const small = planConversion({ meta, target: 'mp4', options: { preset: 'small' } });
    expect(high.mode).toBe('remux');
    expect(high.args[high.args.indexOf('-b:a') + 1]).toBe('256k');
    expect(small.args[small.args.indexOf('-b:a') + 1]).toBe('96k');
  });

  it('非法档位回落 standard，不抛错', () => {
    const plan = planConversion({
      meta: makeMeta(),
      target: 'webm',
      options: { preset: 'ultra' as never },
    });
    expect(plan.preset).toBe('standard');
  });

  it('档位不会污染 warnings 与模式判定', () => {
    const plan = planConversion({ meta: makeMeta(), target: 'webm', options: { preset: 'high' } });
    expect(plan.mode).toBe('transcode');
    expect(plan.warnings.some((w) => w.code === 'VFR_SOURCE')).toBe(false);
  });
});
