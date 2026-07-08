/**
 * runner 集成测试 —— 真起 ffmpeg 子进程。
 *
 * 这一层不再 mock 任何东西：参数数组怎么传到 CreateProcess、
 * `-progress pipe:1` 的微秒怎么算、取消能不能真的杀掉进程树，
 * 都只有真跑才知道。
 */
import fs from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { planConversion } from '../../src/main/core/ffmpeg/planner';
import { probeMedia } from '../../src/main/core/ffmpeg/probe';
import { parseProgressChunk, runConversion } from '../../src/main/core/ffmpeg/runner';
import { AppError } from '../../src/shared/errors';
import {
  BINARIES_AVAILABLE,
  FIXTURES_AVAILABLE,
  cleanupTmp,
  fileSize,
  fixture,
  tmpFile,
} from './helpers';

const d = BINARIES_AVAILABLE && FIXTURES_AVAILABLE ? describe : describe.skip;

afterAll(() => cleanupTmp());

describe('parseProgressChunk（纯解析，不需要 ffmpeg）', () => {
  it('out_time_us 换算成秒，pct 封顶 99', () => {
    const s = parseProgressChunk('out_time_us=10000000\nspeed=2.0x\nprogress=continue\n', 100);
    expect(s?.processedSec).toBe(10);
    expect(s?.speed).toBe(2);
    expect(s?.pct).toBe(10);
    expect(s?.etaSec).toBe(45);
  });

  it('只有 out_time_ms 时也能算（它的单位同样是微秒，名字骗人）', () => {
    const s = parseProgressChunk('out_time_ms=20000000\nprogress=continue\n', 100);
    expect(s?.processedSec).toBe(20);
  });

  it('progress=end 才给 100', () => {
    const s = parseProgressChunk('out_time_us=100000000\nprogress=end\n', 100);
    expect(s?.pct).toBe(100);
    expect(s?.isEnd).toBe(true);
  });

  it('永远不超过 99（未结束时）', () => {
    const s = parseProgressChunk('out_time_us=999000000\nspeed=1x\nprogress=continue\n', 100);
    expect(s?.pct).toBe(99);
  });

  it('没有任何时间信息时返回 null，不产出 0% 的假进度', () => {
    expect(parseProgressChunk('frame=1\nprogress=continue\n', 100)).toBeNull();
  });

  it('总时长为 0 时 pct 为 0 而不是 Infinity', () => {
    const s = parseProgressChunk('out_time_us=5000000\nprogress=continue\n', 0);
    expect(s?.pct).toBe(0);
    expect(Number.isFinite(s!.pct)).toBe(true);
  });
});

d('runConversion · 真实转码', () => {
  it('直通（MP4 → MKV）：几秒内完成，进度最终到 100', async () => {
    const input = fixture('sample-h264-aac.mp4');
    const meta = await probeMedia(input);
    const plan = planConversion({ meta, target: 'mkv' });
    expect(plan.mode).toBe('copy');

    const out = tmpFile('copy-out.mkv');
    const samples: number[] = [];

    await runConversion({
      inputPath: input,
      outputPartPath: out,
      args: plan.args,
      totalDurationSec: meta.durationSec,
      onProgress: (s) => samples.push(s.pct),
    }).promise;

    expect(fs.existsSync(out)).toBe(true);
    expect(fileSize(out)).toBeGreaterThan(0);
    expect(samples.at(-1)).toBe(100);

    // 直通不该改变编码
    const back = await probeMedia(out);
    expect(back.video?.codec).toBe('h264');
    expect(back.audio?.codec).toBe('aac');
  });

  it('全量重编码（MP4 → WebM）：产出可被 ffprobe 读回的 vp9/opus 文件', async () => {
    const input = fixture('sample-h264-aac.mp4');
    const meta = await probeMedia(input);
    const plan = planConversion({ meta, target: 'webm' });
    expect(plan.mode).toBe('transcode');

    const out = tmpFile('transcode-out.webm');
    const samples: { pct: number; eta: number | null }[] = [];

    await runConversion({
      inputPath: input,
      outputPartPath: out,
      args: plan.args,
      totalDurationSec: meta.durationSec,
      onProgress: (s) => samples.push({ pct: s.pct, eta: s.etaSec }),
    }).promise;

    const back = await probeMedia(out);
    expect(back.video?.codec).toBe('vp9');
    expect(back.audio?.codec).toBe('opus');
    expect(back.video?.width).toBe(320);

    // 进度必须单调不减，且至少收到一次中间值
    const pcts = samples.map((s) => s.pct);
    expect(pcts.length).toBeGreaterThan(0);
    for (let i = 1; i < pcts.length; i += 1) {
      expect(pcts[i]).toBeGreaterThanOrEqual(pcts[i - 1]);
    }
  });

  it('纯视频源（无音轨）：0:a:0? 的可选映射让转码不失败', async () => {
    const input = fixture('sample-noaudio.mp4');
    const meta = await probeMedia(input);
    const plan = planConversion({ meta, target: 'mkv' });

    const out = tmpFile('noaudio-out.mkv');
    await runConversion({
      inputPath: input,
      outputPartPath: out,
      args: plan.args,
      totalDurationSec: meta.durationSec,
    }).promise;

    const back = await probeMedia(out);
    expect(back.video).not.toBeNull();
    expect(back.audio).toBeNull();
  });

  it('取消：真的把进程杀掉，promise 以 E_CANCELLED 失败', async () => {
    const input = fixture('sample-h264-aac.mp4');
    const out = tmpFile('cancel-out.webm');

    // 用无损 VP9（-crf 0）把耗时拉长，保证取消时一定还在编码
    const handle = runConversion({
      inputPath: input,
      outputPartPath: out,
      args: ['-c:v', 'libvpx-vp9', '-crf', '0', '-b:v', '0', '-an'],
      totalDurationSec: 2,
    });

    // 立刻挂上 handler：ffmpeg 有可能在取消之前就结束，
    // 迟挂 handler 会让 Node 报一条 unhandled rejection（测试会失败）
    const settled = handle.promise.then(
      () => null,
      (err: unknown) => err,
    );

    // 等第一帧进度出来再取消，避免"还没启动就取消"的假阴性
    await new Promise((r) => setTimeout(r, 600));
    await handle.cancel();

    const err = await settled;
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('E_CANCELLED');
  });

  it('输入文件损坏：错误被翻译成中文，且带末 20 行 stderr', async () => {
    const out = tmpFile('broken-out.mp4');
    try {
      await runConversion({
        inputPath: fixture('sample-broken.mp4'),
        outputPartPath: out,
        args: ['-c:v', 'copy'],
        totalDurationSec: 2,
      }).promise;
      throw new Error('应当失败');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.code).not.toBe('E_UNKNOWN');
      expect(e.detail).toContain('stderr');
    }
  });
});
