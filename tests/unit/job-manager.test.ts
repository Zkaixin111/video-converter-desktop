/**
 * 队列调度（JobManager）的单元测试。
 *
 * 调度逻辑本来只能靠集成测试（真起 ffmpeg），代价是 10 个任务要真转 10 个视频。
 * 所以这里注入一个**假任务**：它起手就不结束，由测试自己决定何时终态 ——
 * 「并发几个、什么时候算一批结束、删了排队任务会不会误报」都能毫秒级验证。
 */
import { describe, expect, it } from 'vitest';
import type { BatchSummary, ContainerKey, JobSnapshot, MediaMeta } from '../../src/shared/types';
import {
  JobManager,
  type JobFactory,
  type EnqueueInput,
} from '../../src/main/core/job/JobManager';

type Terminal = 'done' | 'error' | 'cancelled';

/** 假任务的手柄：测试握住它就能在任意时刻宣布这个任务结束 */
interface FakeHandle {
  jobId: string;
  finish: (status: Terminal) => void;
  cancelRequested: boolean;
}

function meta(name: string): MediaMeta {
  return {
    path: `C:\\videos\\${name}.mp4`,
    fileName: `${name}.mp4`,
    sizeBytes: 1024,
    durationSec: 10,
    formatName: 'mov,mp4',
    video: {
      codec: 'h264',
      codecLongName: 'H.264',
      width: 1280,
      height: 720,
      fps: 30,
      isVfr: false,
      bitrateKbps: 2000,
      pixFmt: 'yuv420p',
      bitDepth: 8,
    },
    audio: { codec: 'aac', sampleRate: 48000, channels: 2, bitrateKbps: 128 },
    audioTracks: 1,
    subtitleTracks: 0,
    warnings: [],
  };
}

function input(name: string): EnqueueInput {
  return {
    meta: meta(name),
    target: 'mkv' as ContainerKey,
    preset: 'standard',
    custom: null,
    outputDir: null,
  };
}

function fakeFactory(into: FakeHandle[]): JobFactory {
  return (opts) => {
    const emit = opts.onState;
    const handle: FakeHandle = {
      jobId: opts.jobId,
      cancelRequested: false,
      finish: (status) => {
        const snapshot: JobSnapshot = {
          status,
          jobId: opts.jobId,
          fileName: opts.meta.fileName,
          sourcePath: opts.meta.path,
          target: opts.target,
          preset: 'standard',
          sourceSizeBytes: opts.meta.sizeBytes,
          result:
            status === 'done'
              ? {
                  jobId: opts.jobId,
                  outputPath: opts.outputPath,
                  outputSizeBytes: 512,
                  sourceSizeBytes: opts.meta.sizeBytes,
                  elapsedMs: 10,
                  mode: 'transcode',
                  verified: true,
                }
              : undefined,
          error: status === 'error' ? { code: 'E_FFMPEG_FAILED', message: '转换失败。' } : undefined,
        };
        emit?.(snapshot);
      },
    };
    into.push(handle);
    return {
      // 永不自行结束：结束时机由测试说了算
      run: () => new Promise(() => {}),
      cancel: async () => {
        handle.cancelRequested = true;
        // 真 ConversionJob 被杀进程后会走到 cancelled 终态，这里照做，
        // 否则「取消其中一个、另外几个继续跑」这条根本验证不了
        handle.finish('cancelled');
      },
    };
  };
}

interface Rig {
  jm: JobManager;
  handles: FakeHandle[];
  summaries: BatchSummary[];
}

function rig(policy: 'continue' | 'pause' = 'continue', concurrency = 1): Rig {
  const handles: FakeHandle[] = [];
  const summaries: BatchSummary[] = [];
  const jm = new JobManager({
    createJob: fakeFactory(handles),
    getPolicy: () => policy,
    getConcurrency: () => concurrency,
    exists: () => false,
  });
  jm.attach({ onBatchFinished: (s) => summaries.push(s) });
  return { jm, handles, summaries };
}

/** 取第 n 个进入终态的任务（按入队顺序，队列是 FIFO 串行的） */
function nth(handles: FakeHandle[], n: number): FakeHandle {
  const h = handles[n];
  if (!h) throw new Error(`只起过 ${handles.length} 个任务，拿不到第 ${n} 个`);
  return h;
}

describe('队列排空调度 · 串行基线', () => {
  it('同一时刻只有一个任务在跑', () => {
    const { jm, handles } = rig();
    jm.enqueue([input('a'), input('b'), input('c')]);
    expect(handles).toHaveLength(1);

    nth(handles, 0).finish('done');
    expect(handles).toHaveLength(2);

    nth(handles, 1).finish('done');
    expect(handles).toHaveLength(3);
  });

  it('三个都成功才汇报一次（10 个文件也只有一条通知）', () => {
    const { jm, handles, summaries } = rig();
    jm.enqueue([input('a'), input('b'), input('c')]);

    nth(handles, 0).finish('done');
    nth(handles, 1).finish('done');
    expect(summaries).toHaveLength(0);

    nth(handles, 2).finish('done');
    expect(summaries).toEqual([{ done: 3, failed: 0, cancelled: 0 }]);
  });

  it('掺了失败与取消也只汇报一次，并分桶计数', () => {
    const { jm, handles, summaries } = rig();
    jm.enqueue([input('a'), input('b'), input('c')]);

    nth(handles, 0).finish('done');
    nth(handles, 1).finish('error');
    nth(handles, 2).finish('cancelled');
    expect(summaries).toEqual([{ done: 1, failed: 1, cancelled: 1 }]);
  });

  it('单文件转换也汇报（界面有结果卡，但通知照样发）', () => {
    const { jm, handles, summaries } = rig();
    jm.enqueue([input('a')]);
    nth(handles, 0).finish('done');
    expect(summaries).toEqual([{ done: 1, failed: 0, cancelled: 0 }]);
  });
});

/**
 * 并发调度（TODO-10）。
 *
 * 验收要点里最要命的一条是「并发 1 时行为与现在逐条一致」——
 * 上面那组串行基线测试就是这条的保险，改动调度模型后它们必须一条不变地通过。
 */
describe('并发调度 · 同时起几个', () => {
  it('并发 1 时逐个起，队列里永远只有一个在跑', () => {
    const { jm, handles } = rig('continue', 1);
    jm.enqueue([input('a'), input('b'), input('c')]);
    expect(jm.list().activeIds).toHaveLength(1);

    nth(handles, 0).finish('done');
    expect(jm.list().activeIds).toHaveLength(1);
    expect(handles).toHaveLength(2);
  });

  it('并发 3 时立刻起满 3 个，第 4 个等前面空出来', () => {
    const { jm, handles } = rig('continue', 3);
    jm.enqueue(Array.from({ length: 4 }, (_, i) => input(`v${i}`)));

    expect(handles).toHaveLength(3);
    expect(jm.list().activeIds).toHaveLength(3);

    nth(handles, 0).finish('done');
    expect(handles).toHaveLength(4);
    expect(jm.list().activeIds).toHaveLength(3);
  });

  it('并发数上限 4：设置里填 99 也只跑到 4', () => {
    const { jm, handles } = rig('continue', 99);
    jm.enqueue(Array.from({ length: 6 }, (_, i) => input(`v${i}`)));
    expect(handles).toHaveLength(4);
  });

  it('并发下失败暂停只停一次，且在跑的会让它跑完', () => {
    const { jm, handles, summaries } = rig('pause', 3);
    jm.enqueue(Array.from({ length: 4 }, (_, i) => input(`v${i}`)));

    nth(handles, 0).finish('error');
    expect(jm.list().paused).toBe(true);
    // 第 4 个没起 —— 暂停就是不补新的
    expect(handles).toHaveLength(3);

    // 另外两个在跑的照常结束，此时队列里还压着失败项，不算一批结束
    nth(handles, 1).finish('done');
    nth(handles, 2).finish('done');
    expect(summaries).toHaveLength(0);

    // 用户删掉失败项并继续，剩下的跑完才汇报
    const failed = jm.list().items.find((i) => i.status === 'error');
    jm.remove(failed!.jobId);
    nth(handles, 3).finish('done');
    expect(summaries).toEqual([{ done: 3, failed: 1, cancelled: 0 }]);
  });

  it('取消其中一个，另外两个继续跑，且立刻补上排队的那条', async () => {
    const { jm, handles } = rig('continue', 3);
    jm.enqueue(Array.from({ length: 5 }, (_, i) => input(`v${i}`)));
    const [a, b, c] = handles;

    await jm.cancel(a!.jobId);
    // 取消的是 a，b / c 毫发无损；空出来的位置被队列里第 4 条顶上
    expect(jm.list().activeIds).toEqual([b!.jobId, c!.jobId, nth(handles, 3).jobId]);
  });

  it('移除排队的任务，在跑的一个都不少', () => {
    const { jm } = rig('continue', 3);
    jm.enqueue(Array.from({ length: 5 }, (_, i) => input(`v${i}`)));

    const pending = jm.list().items.filter((i) => i.status === 'pending');
    expect(pending).toHaveLength(2);

    jm.remove(pending[0]!.jobId);
    expect(jm.list().activeIds).toHaveLength(3);
  });

  it('退出时把在跑的全部停掉（并发下漏一个就是孤儿进程）', async () => {
    const { jm, handles } = rig('continue', 3);
    jm.enqueue(Array.from({ length: 5 }, (_, i) => input(`v${i}`)));

    await jm.dispose();
    expect(handles.filter((h) => h.cancelRequested)).toHaveLength(3);
  });

  it('整体进度按「已结算 / 总数」算，而不是单个任务的百分比', () => {
    const { jm, handles } = rig('continue', 2);
    jm.enqueue(Array.from({ length: 4 }, (_, i) => input(`v${i}`)));
    expect(jm.list().batch).toEqual({ total: 4, settled: 0 });

    nth(handles, 0).finish('done');
    expect(jm.list().batch).toEqual({ total: 4, settled: 1 });
  });
});

describe('队列排空调度 · 不该汇报的情形', () => {
  it('成功与取消会移出队列，失败会留在队列里等处理', () => {
    const { jm, handles } = rig();
    jm.enqueue([input('a'), input('b')]);

    nth(handles, 0).finish('cancelled');
    expect(jm.list().items.map((i) => i.fileName)).toEqual(['b.mp4']);

    nth(handles, 1).finish('error');
    expect(jm.list().items.map((i) => i.fileName)).toEqual(['b.mp4']);
    expect(jm.list().items[0]?.status).toBe('error');
  });

  it('「失败即暂停」时队列里还压着活儿，这一批不算结束', () => {
    const { jm, handles, summaries } = rig('pause');
    jm.enqueue([input('a'), input('b'), input('c')]);

    nth(handles, 0).finish('done');
    nth(handles, 1).finish('error');
    // 第三个还没跑，队列因为失败暂停了 —— 此时不该通知
    expect(summaries).toHaveLength(0);
    expect(jm.list().paused).toBe(true);
  });

  it('删掉排队任务不会提前弹通知（否则会变成「0 个成功」）', () => {
    const { jm, handles, summaries } = rig();
    jm.enqueue([input('a'), input('b'), input('c')]);

    // 后面两个不想要了，直接删掉 —— 此时 a 还在跑，这一批远没结束
    const waiting = jm.list().items.filter((i) => i.status === 'pending');
    expect(waiting).toHaveLength(2);
    for (const w of waiting) jm.remove(w.jobId);

    expect(summaries).toHaveLength(0);
    // 分母也要跟着缩，否则会显示「已完成 1 / 3」
    expect(jm.list().batch).toEqual({ total: 1, settled: 0 });

    nth(handles, 0).finish('done');
    expect(summaries).toEqual([{ done: 1, failed: 0, cancelled: 0 }]);
  });

  it('上一批的账不会带进下一批', () => {
    const { jm, handles, summaries } = rig();
    jm.enqueue([input('a')]);
    nth(handles, 0).finish('done');

    jm.enqueue([input('b')]);
    nth(handles, 1).finish('done');

    // 两批各自结算，不会因为共用一个计数器就报成「2 个成功」
    expect(summaries).toEqual([
      { done: 1, failed: 0, cancelled: 0 },
      { done: 1, failed: 0, cancelled: 0 },
    ]);
  });
});
