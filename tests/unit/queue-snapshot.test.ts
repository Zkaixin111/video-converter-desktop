/**
 * 队列快照持久化（TODO-12）的单测。
 *
 * 这个文件承担两件事：
 *   1. **文件层**（QueuePersistence）：落盘 / 读回 / 损坏容错 / 正常退出清理
 *   2. **调度层**（JobManager.restore / persistable）：恢复语义才是真正容易写错的地方——
 *      比如「恢复了就自动跑起来」「顺序被排序打乱」「源文件没了还假排队」。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MediaMeta, PersistedQueueItem } from '../../src/shared/types';
import { QUEUE_ITEM_LIMIT, QueuePersistence } from '../../src/main/core/job/queuePersistence';
import { JobManager, type EnqueueInput, type JobFactory } from '../../src/main/core/job/JobManager';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-snap-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

function item(over: Partial<PersistedQueueItem> & { jobId: string }): PersistedQueueItem {
  return {
    meta: meta('a'),
    target: 'mkv',
    preset: 'standard',
    custom: null,
    outputDir: null,
    outputPath: `C:\\videos\\${over.jobId}.mkv`,
    audio: null,
    status: 'pending',
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

describe('QueuePersistence · 文件层', () => {
  it('文件不存在时返回空列表', () => {
    const store = new QueuePersistence(path.join(tmpDir, 'queue.json'));
    expect(store.read()).toEqual([]);
  });

  it('写入后能原样读回，字段不丢', () => {
    const file = path.join(tmpDir, 'queue.json');
    const store = new QueuePersistence(file);
    const one = item({ jobId: 'x1', interrupted: true });
    store.write([one]);

    const back = store.read();
    expect(back).toHaveLength(1);
    expect(back[0].jobId).toBe('x1');
    expect(back[0].interrupted).toBe(true);
    expect(back[0].meta.fileName).toBe('a.mp4');
  });

  it('顺序不被排序打乱：pending 的先后就是用户排的队', () => {
    const file = path.join(tmpDir, 'queue.json');
    const store = new QueuePersistence(file);
    store.write([item({ jobId: 'c' }), item({ jobId: 'a' }), item({ jobId: 'b' })]);
    expect(store.read().map((i) => i.jobId)).toEqual(['c', 'a', 'b']);
  });

  it('写空列表等于删掉文件（「此刻没有需要恢复的东西」）', () => {
    const file = path.join(tmpDir, 'queue.json');
    const store = new QueuePersistence(file);
    store.write([item({ jobId: 'x' })]);
    expect(fs.existsSync(file)).toBe(true);

    store.write([]);
    expect(fs.existsSync(file)).toBe(false);
    expect(store.read()).toEqual([]);
  });

  it('写入是原子替换，不留下 .tmp 残片', () => {
    const file = path.join(tmpDir, 'queue.json');
    const store = new QueuePersistence(file);
    store.write([item({ jobId: 'x' })]);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('JSON 损坏时返回空列表而不是抛错', () => {
    const file = path.join(tmpDir, 'queue.json');
    fs.writeFileSync(file, '{"version":1,"items":[{"jobId"', 'utf8');
    expect(new QueuePersistence(file).read()).toEqual([]);
  });

  it('结构合法但 items 不是数组时返回空列表', () => {
    const file = path.join(tmpDir, 'queue.json');
    fs.writeFileSync(file, '{"version":1,"items":{"a":1}}', 'utf8');
    expect(new QueuePersistence(file).read()).toEqual([]);
  });

  it('混入坏记录时只丢掉坏的那条', () => {
    const file = path.join(tmpDir, 'queue.json');
    const store = new QueuePersistence(file);
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        savedAt: 1,
        items: [item({ jobId: 'ok' }), { jobId: '' }, null, { nope: 1 }],
      }),
      'utf8',
    );
    expect(store.read().map((i) => i.jobId)).toEqual(['ok']);
  });

  it('缺 interrupted / createdAt 的旧数据也能读回来', () => {
    const file = path.join(tmpDir, 'queue.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, savedAt: 1, items: [{ ...item({ jobId: 'old' }), interrupted: undefined }] }),
      'utf8',
    );
    const back = new QueuePersistence(file).read();
    expect(back[0].interrupted).toBe(false);
    expect(typeof back[0].createdAt).toBe('number');
  });

  it('条数超上限时截断，避免异常数据一次灌进几百条', () => {
    const file = path.join(tmpDir, 'queue.json');
    const many = Array.from({ length: QUEUE_ITEM_LIMIT + 12 }, (_, i) =>
      item({ jobId: `id-${i}`, outputPath: `C:\\videos\\${i}.mkv` }),
    );
    new QueuePersistence(file).write(many);
    expect(new QueuePersistence(file).read()).toHaveLength(QUEUE_ITEM_LIMIT);
  });
});

/* ── 调度层 ─────────────────────────────────────────────── */

type Terminal = 'done' | 'error' | 'cancelled';

interface FakeHandle {
  jobId: string;
  finish: (status: Terminal) => void;
}

function input(name: string): EnqueueInput {
  return { meta: meta(name), target: 'mkv', preset: 'standard', custom: null, outputDir: null };
}

function fakeFactory(into: FakeHandle[]): JobFactory {
  return (opts) => {
    const emit = opts.onState;
    const handle: FakeHandle = {
      jobId: opts.jobId,
      finish: (status) => {
        emit?.({
          status,
          jobId: opts.jobId,
          fileName: opts.meta.fileName,
          sourcePath: opts.meta.path,
          target: opts.target,
          preset: opts.preset,
          error: status === 'error' ? { code: 'E_FFMPEG_FAILED', message: '转换失败。' } : undefined,
        });
      },
    };
    into.push(handle);
    return { run: () => new Promise(() => {}), cancel: async () => handle.finish('cancelled') };
  };
}

/**
 * 一个虚拟文件系统。
 *
 * 不能用 `exists: () => true`（那会让输出路径永远冲突、解析直接抛错），
 * 也不能用 `() => false`（那会让 restore 判定「源文件都没了」）。
 * 所以按名字登记哪些文件还在——输入文件的路径是 `C:\videos\<name>.mp4`。
 */
function rig(aliveNames: string[] = ['a', 'b', 'c'], concurrency = 1) {
  const handles: FakeHandle[] = [];
  const existing = new Set(aliveNames.map((n) => `C:\\videos\\${n}.mp4`));
  const jm = new JobManager({
    createJob: fakeFactory(handles),
    getPolicy: () => 'continue',
    getConcurrency: () => concurrency,
    exists: (p) => existing.has(p),
  });
  return { jm, handles };
}

describe('JobManager · 队列快照与恢复', () => {
  it('persistable 只留还没跑完的与失败的，成功的不留', () => {
    const { jm, handles } = rig();
    jm.enqueue([input('a'), input('b'), input('c')]);

    handles[0].finish('done');
    const persisted = jm.persistable();
    // a 成功了出列；b 在跑要留（标 interrupted）；c 还没轮到要留
    expect(persisted.map((i) => i.meta.fileName)).toEqual(['b.mp4', 'c.mp4']);
  });

  it('正在跑的任务落盘时标 interrupted，等待中的不标', () => {
    const { jm } = rig();
    jm.enqueue([input('a'), input('b')]);
    const persisted = jm.persistable();
    expect(persisted[0].interrupted).toBe(true);
    expect(persisted[1].interrupted).toBe(false);
  });

  it('失败的任务连错误一起保存，恢复后仍然标红', () => {
    const { jm, handles } = rig();
    jm.enqueue([input('a'), input('b')]);
    handles[0].finish('error');

    const persisted = jm.persistable();
    expect(persisted[0].status).toBe('error');
    expect(persisted[0].error?.code).toBe('E_FFMPEG_FAILED');
  });

  it('取消的任务不落盘（它已经耗尽用户的意愿，不该再回来）', () => {
    const { jm, handles } = rig();
    jm.enqueue([input('a'), input('b')]);
    handles[0].finish('cancelled');
    expect(jm.persistable().map((i) => i.meta.fileName)).toEqual(['b.mp4']);
  });

  it('队列排空后快照为空（＝文件被删掉）', () => {
    const { jm, handles } = rig();
    jm.enqueue([input('a')]);
    handles[0].finish('done');
    expect(jm.persistable()).toEqual([]);
  });

  it('恢复后保持暂停，一个都不自动跑', () => {
    const { jm, handles } = rig();
    jm.restore([item({ jobId: 'r1' }), item({ jobId: 'r2' })]);

    expect(handles).toHaveLength(0);
    expect(jm.list().paused).toBe(true);
    expect(jm.list().pausedReason).toBe('restored');
  });

  it('恢复的顺序与落盘顺序一致，不会被重排', () => {
    const { jm } = rig();
    jm.restore([
      item({ jobId: 'r3', meta: meta('c') }),
      item({ jobId: 'r1', meta: meta('a') }),
      item({ jobId: 'r2', meta: meta('b') }),
    ]);
    expect(jm.list().items.map((i) => i.fileName)).toEqual(['c.mp4', 'a.mp4', 'b.mp4']);
  });

  it('interrupted 的任务在界面上看得出来', () => {
    const { jm } = rig();
    jm.restore([item({ jobId: 'r1', interrupted: true }), item({ jobId: 'r2' })]);
    expect(jm.list().items[0].interrupted).toBe(true);
    expect(jm.list().items[1].interrupted).toBe(false);
  });

  it('恢复沿用原 jobId：日志与历史还能对得上', () => {
    const { jm } = rig();
    jm.restore([item({ jobId: 'keep-me' })]);
    expect(jm.list().items[0].jobId).toBe('keep-me');
  });

  it('恢复后整体进度按恢复条数记，不沿用上次跑完的账', () => {
    const { jm } = rig();
    jm.restore([item({ jobId: 'r1' }), item({ jobId: 'r2' })]);
    expect(jm.list().batch).toEqual({ total: 2, settled: 0 });
  });

  it('用户确认 continue 之后按原顺序跑起来', () => {
    const { jm, handles } = rig();
    jm.restore([item({ jobId: 'r1', meta: meta('a') }), item({ jobId: 'r2', meta: meta('b') })]);
    jm.resume();

    expect(handles).toHaveLength(1);
    expect(handles[0].jobId).toBe('r1');
  });

  it('源文件已经不在 → 标失败并给出原因，而不是排到它时才炸', () => {
    const { jm } = rig([]);
    jm.restore([item({ jobId: 'gone', meta: meta('deleted') })]);

    const restored = jm.list().items[0];
    expect(restored.status).toBe('error');
    expect(restored.error?.code).toBe('E_FILE_NOT_FOUND');
  });

  it('规划失败（源文件变成了纯音频）也不静默丢弃', () => {
    const { jm } = rig(['silent']);
    jm.restore([
      item({ jobId: 'no-video', meta: { ...meta('silent'), video: null } }),
    ]);
    expect(jm.list().items[0].status).toBe('error');
    expect(jm.list().items[0].error?.code).toBe('E_NO_VIDEO_STREAM');
  });

  it('恢复是替换而不是追加：反复调用不会把队列撑成两倍', () => {
    const { jm } = rig();
    jm.restore([item({ jobId: 'r1' }), item({ jobId: 'r2' })]);
    jm.restore([item({ jobId: 'r1' }), item({ jobId: 'r2' })]);
    expect(jm.list().items).toHaveLength(2);
  });

  it('落盘 → 恢复走一个来回，参数与顺序都不变', () => {
    const first = rig();
    first.jm.enqueue([input('a'), input('b'), input('c')]);
    first.handles[0].finish('done');
    const snapshot = first.jm.persistable();

    const second = rig();
    second.jm.restore(snapshot);
    // a 已成功出列；b/c 按原顺序回来，且 b 标着「上次正在转」
    expect(second.jm.list().items.map((i) => [i.fileName, i.interrupted])).toEqual([
      ['b.mp4', true],
      ['c.mp4', false],
    ]);
    expect(second.jm.list().items[0].target).toBe('mkv');
  });

  it('空快照恢复等于什么都不做：不该把队列停成暂停态', () => {
    const { jm } = rig();
    jm.restore([]);
    expect(jm.list().paused).toBe(false);
    expect(jm.list().items).toEqual([]);
  });
});
