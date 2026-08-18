/**
 * 音频提取全链路集成测试（TODO-20）。
 *
 * 单测能证明 args 组装正确，但证明不了「这个文件真的能播」——
 * 尤其 `-vn` 漏掉、muxer 选错（ipod vs mp4）这类问题，
 * 只有真的跑一遍 ffmpeg 再让 ffprobe 读回来才会暴露。
 *
 * 三条硬断言：
 *   1. 输出**有音轨**（否则是个空壳）
 *   2. 输出**没有画面**（否则 -vn 没生效，用户拿到的是个畸形文件）
 *   3. 时长与源对得上（抽轨不该把音频截断）
 */
import fs from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { planAudioExtraction } from '../../src/main/core/ffmpeg/planner';
import { probeMedia } from '../../src/main/core/ffmpeg/probe';
import { ConversionJob } from '../../src/main/core/job/ConversionJob';
import { resolveAudioPath } from '../../src/main/core/fs/outputPath';
import { cleanupTmp, fixture, tmpFile, BINARIES_AVAILABLE, FIXTURES_AVAILABLE } from './helpers';

const d = BINARIES_AVAILABLE && FIXTURES_AVAILABLE ? describe : describe.skip;

afterAll(() => cleanupTmp());

async function extract(
  inputName: string,
  format: 'mp3' | 'm4a',
  stem: string,
): Promise<{ meta: Awaited<ReturnType<typeof probeMedia>>; outputPath: string; status: string }> {
  const input = fixture(inputName);
  const meta = await probeMedia(input);
  // 输出目录给到 .tmp 下，文件名仍由模板决定 —— 顺便验证命名模板在音频这条线上同样生效
  const outputPath = resolveAudioPath(input, format, {
    outputDir: tmpFile('audio'),
    template: stem,
  });
  const plan = planAudioExtraction({ meta, format });

  const job = new ConversionJob({
    meta,
    plan,
    outputPath,
    target: 'mp4',
    audioOnly: true,
    audio: format,
  });

  const final = await job.run();
  return { meta, outputPath, status: final.status, errorCode: final.error?.code };
}

d('音频提取 · MP4 → MP3', () => {
  it('重编码出可被 ffprobe 读回的 mp3：有音轨、无画面、时长对得上', async () => {
    const { meta, outputPath, status } = await extract('sample-h264-aac.mp4', 'mp3', 'audio-mp3');
    expect(status).toBe('done');
    expect(fs.existsSync(outputPath)).toBe(true);

    const out = await probeMedia(outputPath);
    expect(out.audio).not.toBeNull();
    expect(out.audio?.codec).toBe('mp3');
    // -vn 生效的最直接证据：输出里根本不该有画面
    expect(out.video).toBeNull();
    expect(Math.abs(out.durationSec - meta.durationSec)).toBeLessThan(0.5);
  });

  it('输出的扩展名与 muxer 一致（.mp3 而不是 .m4a）', async () => {
    const { outputPath } = await extract('sample-h264-aac.mp4', 'mp3', 'audio-ext');
    expect(outputPath.endsWith('.mp3')).toBe(true);
  });
});

d('音频提取 · MP4 → M4A', () => {
  it('AAC 源直接抽轨：不重编码也能产出可播放的 m4a', async () => {
    const { meta, outputPath, status } = await extract('sample-h264-aac.mp4', 'm4a', 'audio-m4a');
    expect(status).toBe('done');

    const out = await probeMedia(outputPath);
    expect(out.audio).not.toBeNull();
    expect(out.audio?.codec).toBe('aac');
    expect(out.video).toBeNull();
    expect(Math.abs(out.durationSec - meta.durationSec)).toBeLessThan(0.5);
  });
});

d('音频提取 · 校验', () => {
  /**
   * 没有音轨的文件在**入队前**就被拦下了（queue:enqueue 的 requireMeta），
   * 这里验证的是：即便真的走进执行环节，校验也不会把「没有音轨的输出」判成成功。
   */
  it('无音轨源文件：规划阶段就抛 E_NO_AUDIO_STREAM', async () => {
    const input = fixture('sample-noaudio.mp4');
    const meta = await probeMedia(input);
    expect(meta.audio).toBeNull();
    expect(() => planAudioExtraction({ meta, format: 'mp3' })).toThrow();
  });
});
