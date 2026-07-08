/**
 * probe 集成测试 —— 真的起 ffprobe 读真的文件。
 *
 * 单测只覆盖了「JSON → MediaMeta」的归一化，
 * 但真正坑人的是 ffprobe 的输出形态本身（多值 format_name、封面图、截断文件）。
 * 这一层必须用真文件跑。
 */
import { describe, expect, it } from 'vitest';
import { extractThumbnail, probeMedia } from '../../src/main/core/ffmpeg/probe';
import { AppError } from '../../src/shared/errors';
import { BINARIES_AVAILABLE, FIXTURES_AVAILABLE, fixture } from './helpers';

const d = BINARIES_AVAILABLE && FIXTURES_AVAILABLE ? describe : describe.skip;

/** 断言 promise 以 AppError 失败，且错误码在允许集合内 */
async function expectAppError(p: Promise<unknown>, codes: string[]): Promise<AppError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    const e = err as AppError;
    expect(codes).toContain(e.code);
    // 中文文案：不能把英文原文糊到用户脸上
    expect(/[\u4e00-\u9fa5]/.test(e.message)).toBe(true);
    return e;
  }
  throw new Error(`预期抛出 ${codes.join(' / ')}，但调用成功了`);
}

d('probeMedia · 真实文件', () => {
  it('h264 + aac 的 MP4：分辨率/帧率/音轨全部读对', async () => {
    const meta = await probeMedia(fixture('sample-h264-aac.mp4'));

    expect(meta.fileName).toBe('sample-h264-aac.mp4');
    expect(meta.sizeBytes).toBeGreaterThan(0);
    expect(meta.video).not.toBeNull();
    expect(meta.video?.codec).toBe('h264');
    expect(meta.video?.width).toBe(320);
    expect(meta.video?.height).toBe(240);
    expect(meta.video?.fps).toBe(25);
    expect(meta.video?.bitDepth).toBe(8);
    expect(meta.audio?.codec).toBe('aac');
    // fixture 用 lavfi sine 生成，是单声道
    expect(meta.audio?.channels).toBe(1);
    expect(meta.audioTracks).toBe(1);
    expect(meta.durationSec).toBeGreaterThan(1.5);
    expect(meta.durationSec).toBeLessThan(2.5);
    // format_name 是逗号多值，这是「用 === 比较」翻车的地方
    expect(meta.formatName.split(',').length).toBeGreaterThan(1);
  });

  it('MKV 里的 ac3 音轨能被正确识别（用于验证「画面直通 + 音频转码」）', async () => {
    const meta = await probeMedia(fixture('sample-h264-ac3.mkv'));
    expect(meta.video?.codec).toBe('h264');
    expect(meta.audio?.codec).toBe('ac3');
    expect(meta.formatName).toContain('matroska');
  });

  it('AVI 里的 mpeg4 + mp3 能被识别（老编码路径）', async () => {
    const meta = await probeMedia(fixture('sample-mpeg4-mp3.avi'));
    expect(meta.video?.codec).toBe('mpeg4');
    expect(meta.audio?.codec).toBe('mp3');
  });

  it('纯视频文件：audio 为 null，并给出 NO_AUDIO 警告', async () => {
    const meta = await probeMedia(fixture('sample-noaudio.mp4'));
    expect(meta.audio).toBeNull();
    expect(meta.audioTracks).toBe(0);
    expect(meta.warnings.map((w) => w.code)).toContain('NO_AUDIO');
  });

  it('纯音频文件：video 为 null 且不抛错（交给 planner 去做业务判断）', async () => {
    const meta = await probeMedia(fixture('sample-audio.m4a'));
    expect(meta.video).toBeNull();
    expect(meta.audio?.codec).toBe('aac');
  });

  it('截断的 MP4 → 中文的「文件不完整」错误，而不是崩溃', async () => {
    await expectAppError(probeMedia(fixture('sample-broken.mp4')), [
      'E_CORRUPT_FILE',
      'E_INVALID_INPUT',
    ]);
  });

  it('文本改名为 .mp4 → 中文的「格式不符」错误', async () => {
    // ffprobe 对「截断的真 MP4」和「文本改名」报的是同一句话（moov atom not found），
    // 因此两者都会归到 E_CORRUPT_FILE，hint 里同时覆盖「后缀不对」的情况
    const err = await expectAppError(probeMedia(fixture('sample-fake.mp4')), [
      'E_CORRUPT_FILE',
      'E_INVALID_INPUT',
    ]);
    expect(err.hint).toBeTruthy();
  });

  it('文件不存在 → E_FILE_NOT_FOUND（和「文件损坏」分开）', async () => {
    await expectAppError(probeMedia(fixture('does-not-exist.mp4')), ['E_FILE_NOT_FOUND']);
  });
});

d('extractThumbnail', () => {
  it('抽帧成功时返回 base64 的 jpeg dataURL', async () => {
    const url = await extractThumbnail(fixture('sample-h264-aac.mp4'), 1);
    expect(url).toBeTruthy();
    expect(url?.startsWith('data:image/jpeg;base64,')).toBe(true);
    // 解出来确实是一张图（JPEG magic number FF D8）
    const b64 = url!.split(',')[1];
    const head = Buffer.from(b64.slice(0, 8), 'base64');
    expect(head[0]).toBe(0xff);
    expect(head[1]).toBe(0xd8);
  });

  it('取不到帧时返回 null，不抛错（缩略图失败不能影响主流程）', async () => {
    const url = await extractThumbnail(fixture('sample-fake.mp4'), 1);
    expect(url).toBeNull();
  });
});
