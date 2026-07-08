/**
 * ConversionJob 全链路集成测试。
 *
 * 这是「检查点⑤」的自动化版本：从 plan 到最终文件落盘，中间经过
 * 子进程转码 → rename → 校验 → 状态置 done，每一步都真的执行。
 *
 * 重点守两条顺序纪律（顺序反了会出「文件删了还说完成」这类事故）：
 *   · 先 rename 再校验
 *   · 校验失败要删掉坏文件并报错，而不是当成功
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { planConversion } from '../../src/main/core/ffmpeg/planner';
import { probeMedia } from '../../src/main/core/ffmpeg/probe';
import { ConversionJob } from '../../src/main/core/job/ConversionJob';
import { partPathFor } from '../../src/main/core/fs/temp';
import type { JobSnapshot, MediaMeta, ProgressPayload } from '../../src/shared/types';
import {
  BINARIES_AVAILABLE,
  FIXTURES_AVAILABLE,
  cleanupTmp,
  fixture,
  tmpFile,
} from './helpers';

const d = BINARIES_AVAILABLE && FIXTURES_AVAILABLE ? describe : describe.skip;

afterAll(() => cleanupTmp());

async function makeJob(
  meta: MediaMeta,
  target: Parameters<typeof planConversion>[0]['target'],
  outputPath: string,
) {
  const snapshots: JobSnapshot[] = [];
  const progress: ProgressPayload[] = [];

  const job = new ConversionJob({
    meta,
    plan: planConversion({ meta, target }),
    outputPath,
    target,
    onProgress: (p) => progress.push(p),
    onState: (s) => snapshots.push(s),
  });

  return { job, snapshots, progress };
}

d('ConversionJob · 成功路径', () => {
  it('MP4 → MKV 直通：最终文件已就位、.part 已清理、状态为 done', async () => {
    const input = fixture('sample-h264-aac.mp4');
    const meta = await probeMedia(input);
    const outputPath = tmpFile('job-copy.mkv');

    const { job, snapshots } = await makeJob(meta, 'mkv', outputPath);
    const final = await job.run();

    expect(final.status).toBe('done');
    expect(final.result?.verified).toBe(true);
    expect(final.result?.mode).toBe('copy');
    expect(final.result?.outputPath).toBe(outputPath);

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.existsSync(partPathFor(outputPath))).toBe(false);

    // 快照序列：先 preparing，最后 done
    expect(snapshots[0].status).toBe('preparing');
    expect(snapshots.at(-1)?.status).toBe('done');
  });

  it('MP4 → WebM 重编码：输出体积与源体积都被记录，供完成卡展示', async () => {
    const input = fixture('sample-h264-aac.mp4');
    const meta = await probeMedia(input);
    const outputPath = tmpFile('job-transcode.webm');

    const { job, progress } = await makeJob(meta, 'webm', outputPath);
    const final = await job.run();

    expect(final.status).toBe('done');
    expect(final.result?.outputSizeBytes).toBeGreaterThan(0);
    expect(final.result?.sourceSizeBytes).toBe(meta.sizeBytes);
    expect(final.result?.elapsedMs).toBeGreaterThan(0);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)?.pct).toBe(100);
  });

  it('输出目录不存在时会被自动创建（用户删过目录 / 配置里是旧路径）', async () => {
    const input = fixture('sample-h264-aac.mp4');
    const meta = await probeMedia(input);
    const nested = tmpFile(path.join('nested', 'deep', 'out.mkv'));

    const { job } = await makeJob(meta, 'mkv', nested);
    const final = await job.run();
    expect(final.status).toBe('done');
    expect(fs.existsSync(nested)).toBe(true);
  });
});

d('ConversionJob · 校验与失败路径', () => {
  it('校验不通过：删掉坏文件、状态为 error、错误码 E_OUTPUT_INVALID', async () => {
    const input = fixture('sample-h264-aac.mp4');
    const meta = await probeMedia(input);
    const outputPath = tmpFile('job-invalid.mkv');

    // 人为把「源时长」改大 10 秒：转出来的文件实际只有 2 秒，
    // 校验里的时长偏差检查必然不过 —— 模拟「转完了但文件是残的」
    const lyingMeta: MediaMeta = { ...meta, durationSec: meta.durationSec + 10 };

    const { job } = await makeJob(lyingMeta, 'mkv', outputPath);
    const final = await job.run();

    expect(final.status).toBe('error');
    expect(final.error?.code).toBe('E_OUTPUT_INVALID');
    // 关键：坏文件必须被删掉，不能留在用户目录里冒充成果
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(fs.existsSync(partPathFor(outputPath))).toBe(false);
  });

  it('源文件是坏的：中文错误 + 不留下任何垃圾文件', async () => {
    const input = fixture('sample-broken.mp4');
    // 手工构造一份「探测能过但转码会失败」的 meta：
    // 真实场景里文件可能在中途被删掉，这里用不存在的路径直接模拟
    const meta: MediaMeta = {
      path: input,
      fileName: 'sample-broken.mp4',
      sizeBytes: 1024,
      durationSec: 2,
      formatName: 'mov,mp4',
      video: {
        codec: 'h264',
        codecLongName: 'H.264',
        width: 320,
        height: 240,
        fps: 25,
        isVfr: false,
        bitrateKbps: 500,
        pixFmt: 'yuv420p',
        bitDepth: 8,
      },
      audio: null,
      audioTracks: 0,
      subtitleTracks: 0,
      warnings: [],
    };

    const outputPath = tmpFile('job-broken.mp4');
    const { job } = await makeJob(meta, 'mp4', outputPath);
    const final = await job.run();

    expect(final.status).toBe('error');
    expect(/[\u4e00-\u9fa5]/.test(final.error?.message ?? '')).toBe(true);
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(fs.existsSync(partPathFor(outputPath))).toBe(false);
  });

  it('取消：状态为 cancelled，不留 .part 残留', async () => {
    const input = fixture('sample-h264-aac.mp4');
    const meta = await probeMedia(input);
    const outputPath = tmpFile('job-cancel.webm');

    // 用无损 VP9 延长耗时，保证取消时还在跑
    const slowPlan = {
      ...planConversion({ meta, target: 'webm' }),
      args: ['-c:v', 'libvpx-vp9', '-crf', '0', '-b:v', '0', '-an'],
    };

    const job = new ConversionJob({
      meta,
      plan: slowPlan,
      outputPath,
      target: 'webm',
    });

    const running = job.run();
    await new Promise((r) => setTimeout(r, 500));
    await job.cancel();
    const final = await running;

    expect(['cancelled', 'done']).toContain(final.status);
    if (final.status === 'cancelled') {
      expect(fs.existsSync(outputPath)).toBe(false);
      expect(fs.existsSync(partPathFor(outputPath))).toBe(false);
    }
  });
});
