/**
 * JobManager 队列集成测试（真实 ffmpeg，不 mock）。
 *
 * 队列层最容易出事的地方不是「能不能转」，而是**顺序与失败处理**：
 *   · 单并发：同一时刻只能有一个 ffmpeg 在跑
 *   · 入队即预定输出路径：同源文件的两个任务不能算出同一个路径
 *   · 失败策略：continue 跳过、pause 停下等用户操作
 *   · 重试：jobId 不变、路径重新预定（源文件修好后能真的跑通）
 *
 * 这些行为都没法靠单元测试假出来——pump / handleState 的时序就是产品行为本身，
 * 所以这里全部用真实转码跑一遍。fixture 是 2 秒的小片，单条任务开销可接受。
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeMedia } from '../../src/main/core/ffmpeg/probe';
import { JobManager } from '../../src/main/core/job/JobManager';
import type { MediaMeta, QueueMode, FailurePolicy } from '../../src/shared/types';
import {
  BINARIES_AVAILABLE,
  FIXTURES_AVAILABLE,
  TMP,
  cleanupTmp,
  fixture,
} from './helpers';

const d = BINARIES_AVAILABLE && FIXTURES_AVAILABLE ? describe : describe.skip;

/** 输出目录单独一格，避免和别的测试文件的临时文件互相踩 */
const OUT = path.join(TMP, 'queue');

beforeAll(() => {
  if (!BINARIES_AVAILABLE || !FIXTURES_AVAILABLE) return;
  fs.mkdirSync(OUT, { recursive: true });
});

afterAll(() => {
  // 清理属于收尾，不该因为 Windows 句柄占用把一个绿测试变红
  try {
    fs.rmSync(OUT, { recursive: true, force: true });
  } catch (err) {
    console.warn(`⚠️  queue 临时目录未能清理（不影响用例结果）：${OUT}\n   ${String(err)}`);
  }
  cleanupTmp();
});

/** 轮询等待条件成立，超时直接抛错（比 sleep 固定时间稳，也比直接失败更好定位） */
async function waitFor(fn: () => boolean, label: string, timeoutMs = 30000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`等待超时（${timeoutMs}ms）：${label}`);
}

function makeManager(policy: FailurePolicy, mode: QueueMode = 'shared') {
  const mgr = new JobManager({ getPolicy: () => policy, getMode: () => mode });
  const done: string[] = [];
  mgr.attach({
    onState: (s) => {
      if (s.status === 'done' && s.jobId) done.push(s.jobId);
    },
  });
  return { mgr, done };
}

/** 构造一个「探测信息正常、但源文件不存在」的 meta：转码时必然失败，且失败得很快 */
function brokenMeta(base: MediaMeta, name: string): MediaMeta {
  return { ...base, path: path.join(OUT, name), fileName: name };
}

d('JobManager · 单并发与入队预定', () => {
  it('同源文件入队两次拿到两个不同输出路径，且严格按入队顺序完成', async () => {
    const meta = await probeMedia(fixture('sample-h264-aac.mp4'));
    const { mgr, done } = makeManager('continue');

    const [a, b] = mgr.enqueue([
      { meta, target: 'mkv', preset: 'standard', custom: null, outputDir: OUT },
      { meta, target: 'mkv', preset: 'standard', custom: null, outputDir: OUT },
    ]);

    // 入队即预定：两个任务不会写出同一个文件名（其中一个会被改名加序号）
    expect(a.item.outputPath).not.toBe(b.item.outputPath);
    expect(a.item.outputPath.toLowerCase().endsWith('.mkv')).toBe(true);
    expect(b.item.outputPath.toLowerCase().endsWith('.mkv')).toBe(true);

    // 单并发：第一条立刻开始，第二条只能等着
    const snap = mgr.list();
    expect(['preparing', 'running']).toContain(snap.items[0].status);
    expect(snap.items[1].status).toBe('pending');
    expect(snap.activeId).toBe(a.item.jobId);

    await waitFor(() => mgr.list().items.length === 0, '两个任务都完成');
    // 顺序不能乱：队列是 FIFO，不是「谁快谁先」
    expect(done).toEqual([a.item.jobId, b.item.jobId]);
  });

  it('取消排队中的任务 = 直接移出队列；不影响正在跑的那条', async () => {
    const meta = await probeMedia(fixture('sample-h264-aac.mp4'));
    const { mgr } = makeManager('continue');

    const [a, b] = mgr.enqueue([
      // 第一条故意用 webm 重编码拖住，保证测试期间它还活着
      { meta, target: 'webm', preset: 'high', custom: null, outputDir: OUT },
      { meta, target: 'mkv', preset: 'standard', custom: null, outputDir: OUT },
    ]);

    expect(await mgr.cancel(b.item.jobId)).toBe(true);
    const snap = mgr.list();
    expect(snap.items.some((i) => i.jobId === b.item.jobId)).toBe(false);
    expect(snap.items.some((i) => i.jobId === a.item.jobId)).toBe(true);

    await mgr.dispose();
  });
});

d('JobManager · 失败策略', () => {
  it('策略 continue：失败任务留在队列里，后面的任务照常跑完', async () => {
    const meta = await probeMedia(fixture('sample-h264-aac.mp4'));
    const { mgr, done } = makeManager('continue');

    const [bad, good] = mgr.enqueue([
      { meta: brokenMeta(meta, 'gone-continue.mp4'), target: 'mkv', preset: 'standard', custom: null, outputDir: OUT },
      { meta, target: 'mkv', preset: 'standard', custom: null, outputDir: OUT },
    ]);

    await waitFor(
      () => mgr.list().items.length === 1 && done.length === 1,
      '失败后另一个任务跑完',
    );

    const snap = mgr.list();
    expect(snap.paused).toBe(false);
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0].jobId).toBe(bad.item.jobId);
    expect(snap.items[0].status).toBe('error');
    // 失败原因要能直接展示，否则界面只能写「失败了」
    expect(snap.items[0].error?.message).toBeTruthy();
    expect(done).toEqual([good.item.jobId]);
  });

  it('策略 pause：一个任务失败就停住整个队列，继续后才会往下跑', async () => {
    const meta = await probeMedia(fixture('sample-h264-aac.mp4'));
    const { mgr } = makeManager('pause');

    const [bad, rest] = mgr.enqueue([
      { meta: brokenMeta(meta, 'gone-pause.mp4'), target: 'mkv', preset: 'standard', custom: null, outputDir: OUT },
      { meta, target: 'mkv', preset: 'standard', custom: null, outputDir: OUT },
    ]);

    await waitFor(
      () => mgr.list().items.some((i) => i.jobId === bad.item.jobId && i.status === 'error'),
      '第一条失败',
    );

    let snap = mgr.list();
    expect(snap.paused).toBe(true);
    expect(snap.pausedReason).toBe('failure');
    // 失败的任务不消失（要留给用户重试/删除），后面那条卡在 pending
    expect(snap.items.find((i) => i.jobId === rest.item.jobId)?.status).toBe('pending');
    expect(snap.activeId).toBeNull();

    // 证明它「真的不动」而不是碰巧还没轮到
    await new Promise((r) => setTimeout(r, 600));
    expect(mgr.list().items.find((i) => i.jobId === rest.item.jobId)?.status).toBe('pending');

    // 用户点「继续队列」
    snap = mgr.resume();
    expect(snap.paused).toBe(false);
    expect(snap.pausedReason).toBeNull();

    await waitFor(
      () => !mgr.list().items.some((i) => i.jobId === rest.item.jobId),
      '继续后剩余任务跑完',
    );
    snap = mgr.list();
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0].status).toBe('error');
  });

  it('删除卡住队列的失败任务后，队列自己继续', async () => {
    const meta = await probeMedia(fixture('sample-h264-aac.mp4'));
    const { mgr } = makeManager('pause');

    const [bad, rest] = mgr.enqueue([
      { meta: brokenMeta(meta, 'gone-remove.mp4'), target: 'mkv', preset: 'standard', custom: null, outputDir: OUT },
      { meta, target: 'mkv', preset: 'standard', custom: null, outputDir: OUT },
    ]);

    await waitFor(
      () => mgr.list().items.some((i) => i.jobId === bad.item.jobId && i.status === 'error'),
      '第一条失败',
    );
    expect(mgr.list().paused).toBe(true);

    // 队列里没有别的失败任务了，暂停状态就该自动解除
    const snap = mgr.remove(bad.item.jobId);
    expect(snap.paused).toBe(false);
    expect(snap.pausedReason).toBeNull();

    await waitFor(
      () => !mgr.list().items.some((i) => i.jobId === rest.item.jobId),
      '剩余任务跑完',
    );
    expect(mgr.list().items).toHaveLength(0);
  });
});

d('JobManager · 重试', () => {
  it('源文件修好后重试：jobId 不变、暂停解除、最终真的转完', async () => {
    const meta = await probeMedia(fixture('sample-h264-aac.mp4'));
    const missing = path.join(OUT, 'later-usable.mp4');
    fs.rmSync(missing, { force: true });

    const { mgr, done } = makeManager('pause');
    const [first] = mgr.enqueue([
      { meta: brokenMeta(meta, 'later-usable.mp4'), target: 'mkv', preset: 'standard', custom: null, outputDir: OUT },
    ]);

    await waitFor(() => mgr.list().items[0]?.status === 'error', '首次失败');
    expect(mgr.list().paused).toBe(true);

    // 用户把源文件找回来了（换个位置 / 外接硬盘重新插上）
    fs.copyFileSync(fixture('sample-h264-aac.mp4'), missing);

    const snap = mgr.retry(first.item.jobId);
    expect(snap.items[0].jobId).toBe(first.item.jobId); // 日志与历史能对上同一个任务
    expect(snap.items[0].status).not.toBe('error'); // 失败痕迹已清
    expect(snap.paused).toBe(false);

    await waitFor(() => mgr.list().items.length === 0, '重试后转完');
    expect(done).toEqual([first.item.jobId]);
  });
});

d('JobManager · 单任务独立参数', () => {
  it('改格式会连带重算扩展名；已经跑起来的任务不允许改', async () => {
    const meta = await probeMedia(fixture('sample-h264-aac.mp4'));
    const { mgr } = makeManager('pause', 'per-task');

    const [a, b] = mgr.enqueue([
      // 第一条用 webm 重编码拖住，确保测试执行期间它还在跑
      { meta, target: 'webm', preset: 'high', custom: { target: 'webm', preset: 'high' }, outputDir: OUT },
      { meta, target: 'mkv', preset: 'small', custom: { target: 'mkv', preset: 'small' }, outputDir: OUT },
    ]);

    expect(['preparing', 'running']).toContain(mgr.list().items[0].status);

    // 跑着的任务改参数必须被拒绝，否则会出现「文件已经写出去了，参数才改」
    expect(() =>
      mgr.updateParams(a.item.jobId, {
        target: 'mp4',
        preset: 'standard',
        custom: { target: 'mp4', preset: 'standard' },
      }),
    ).toThrow();

    // 排队中的任务可以改：target / preset / 输出路径三样一起跟着走
    const updated = mgr.updateParams(b.item.jobId, {
      target: 'mp4',
      preset: 'high',
      custom: { target: 'mp4', preset: 'high' },
    });
    expect(updated.target).toBe('mp4');
    expect(updated.preset).toBe('high');
    expect(updated.outputPath.toLowerCase().endsWith('.mp4')).toBe(true);
    expect(updated.custom).toEqual({ target: 'mp4', preset: 'high' });
    expect(updated.status).toBe('pending');

    // 改回「跟随全局」：custom 置空，由主进程重新按全局解析
    const following = mgr.updateParams(b.item.jobId, {
      target: 'mkv',
      preset: 'standard',
      custom: null,
    });
    expect(following.custom).toBeNull();
    expect(following.outputPath.toLowerCase().endsWith('.mkv')).toBe(true);

    await mgr.dispose();
  });
});
