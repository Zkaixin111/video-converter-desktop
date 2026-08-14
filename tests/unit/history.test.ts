/**
 * 转换历史存储的单测。
 *
 * 这里的重点是「坏数据不能把应用带崩」：历史是可有可无的数据，
 * 任何读取异常都必须退化成空列表，而不是抛到 IPC 层。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HistoryStore, normalizeEntry } from '../../src/main/core/job/history';
import type { HistoryEntry } from '../../src/shared/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '../.tmp/unit-history');
const FILE = path.join(DIR, 'history.json');

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'job-1',
    fileName: 'a.mp4',
    sourcePath: 'C:/in/a.mp4',
    outputPath: 'C:/out/a_converted.webm',
    target: 'webm',
    mode: 'transcode',
    preset: 'standard',
    sourceSizeBytes: 1000,
    outputSizeBytes: 800,
    elapsedMs: 1200,
    verified: true,
    finishedAt: 1_700_000_000_000,
    status: 'done',
    ...over,
  };
}

/** 旧版本的记录：那时只记成功，没有 status / preset */
function legacyEntry(): HistoryEntry {
  const e = entry() as unknown as Record<string, unknown>;
  delete e.status;
  delete e.preset;
  return e as unknown as HistoryEntry;
}

beforeEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

describe('HistoryStore 基本读写', () => {
  it('文件不存在时返回空列表，不抛错', () => {
    const store = new HistoryStore(FILE);
    expect(store.list()).toEqual([]);
  });

  it('add 之后能读回，且字段完整', () => {
    const store = new HistoryStore(FILE);
    store.add(entry());
    const [got] = store.list();
    expect(got).toMatchObject({ id: 'job-1', target: 'webm', verified: true });
  });

  it('列表按 finishedAt 倒序（最新在前）', () => {
    const store = new HistoryStore(FILE);
    store.add(entry({ id: 'old', finishedAt: 1000 }));
    store.add(entry({ id: 'new', finishedAt: 3000 }));
    store.add(entry({ id: 'mid', finishedAt: 2000 }));
    expect(store.list().map((e) => e.id)).toEqual(['new', 'mid', 'old']);
  });

  it('写入是原子替换：不留下 .tmp 残片', () => {
    const store = new HistoryStore(FILE);
    store.add(entry());
    expect(fs.existsSync(`${FILE}.tmp`)).toBe(false);
  });
});

describe('HistoryStore 幂等与容量', () => {
  it('同一 id 重复写入只保留一条，并采用最新的时间', () => {
    const store = new HistoryStore(FILE);
    store.add(entry({ finishedAt: 1000 }));
    store.add(entry({ finishedAt: 5000, outputSizeBytes: 123 }));
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].finishedAt).toBe(5000);
    expect(list[0].outputSizeBytes).toBe(123);
  });

  it('超过上限时淘汰最旧的一条', () => {
    const store = new HistoryStore(FILE, 3);
    for (let i = 1; i <= 5; i += 1) {
      store.add(entry({ id: `job-${i}`, finishedAt: i * 1000 }));
    }
    expect(store.list().map((e) => e.id)).toEqual(['job-5', 'job-4', 'job-3']);
  });

  it('remove 只删指定的一条', () => {
    const store = new HistoryStore(FILE);
    store.add(entry({ id: 'a', finishedAt: 1 }));
    store.add(entry({ id: 'b', finishedAt: 2 }));
    const rest = store.remove('a');
    expect(rest.map((e) => e.id)).toEqual(['b']);
    expect(store.list().map((e) => e.id)).toEqual(['b']);
  });

  it('clear 之后列表为空，文件仍可继续写入', () => {
    const store = new HistoryStore(FILE);
    store.add(entry());
    store.clear();
    expect(store.list()).toEqual([]);
    store.add(entry({ id: 'after' }));
    expect(store.list().map((e) => e.id)).toEqual(['after']);
  });
});

describe('HistoryStore 容错', () => {
  it('JSON 损坏时返回空列表，且下一次 add 能自愈', () => {
    fs.writeFileSync(FILE, '{ this is not json', 'utf8');
    const store = new HistoryStore(FILE);
    expect(store.list()).toEqual([]);
    store.add(entry({ id: 'recovered' }));
    expect(store.list().map((e) => e.id)).toEqual(['recovered']);
  });

  it('结构合法但不是数组时返回空列表', () => {
    fs.writeFileSync(FILE, JSON.stringify({ version: 1, entries: 'oops' }), 'utf8');
    expect(new HistoryStore(FILE).list()).toEqual([]);
  });

  it('数组里混入坏记录时只丢掉坏的那条', () => {
    const good = entry({ id: 'good' });
    fs.writeFileSync(
      FILE,
      JSON.stringify({ version: 1, entries: [good, { id: 'no-output' }, null, 42] }),
      'utf8',
    );
    expect(new HistoryStore(FILE).list().map((e) => e.id)).toEqual(['good']);
  });

  it('目录不存在时会自动创建（首次写入）', () => {
    const nested = path.join(DIR, 'deep', 'nested', 'history.json');
    new HistoryStore(nested).add(entry());
    expect(fs.existsSync(nested)).toBe(true);
  });
});

/**
 * 旧版 history.json 兼容（TODO-07）。
 *
 * 老版本只在成功时写历史，记录里没有 status / preset 两个字段。
 * 升级后必须还能照常展示与重跑 —— 让用户「清空历史才能用新版本」是不可接受的。
 */
describe('HistoryStore 旧数据迁移', () => {
  it('缺 status 的记录按成功处理', () => {
    fs.writeFileSync(FILE, JSON.stringify({ version: 1, entries: [legacyEntry()] }), 'utf8');
    const [got] = new HistoryStore(FILE).list();
    expect(got.status).toBe('done');
  });

  it('缺 preset 的记录按 standard 处理', () => {
    fs.writeFileSync(FILE, JSON.stringify({ version: 1, entries: [legacyEntry()] }), 'utf8');
    const [got] = new HistoryStore(FILE).list();
    expect(got.preset).toBe('standard');
  });

  it('unknown 之类的脏 status 也按成功处理（不猜失败）', () => {
    const dirty = { ...entry(), status: 'weird' } as unknown as HistoryEntry;
    expect(normalizeEntry(dirty).status).toBe('done');
  });

  it('失败与取消状态原样读回，不被迁移抹平', () => {
    const store = new HistoryStore(FILE);
    store.add(entry({ id: 'f1', status: 'failed', error: { code: 'E_FFMPEG_FAILED', message: '转换失败。' } }));
    store.add(entry({ id: 'c1', status: 'cancelled' }));
    const byId = Object.fromEntries(store.list().map((e) => [e.id, e]));
    expect(byId.f1?.status).toBe('failed');
    expect(byId.f1?.error?.code).toBe('E_FFMPEG_FAILED');
    expect(byId.c1?.status).toBe('cancelled');
  });

  it('get 能按 id 取回一条（一键重跑靠它）', () => {
    const store = new HistoryStore(FILE);
    store.add(entry({ id: 'x', finishedAt: 1 }));
    store.add(entry({ id: 'y', finishedAt: 2 }));
    expect(store.get('y')?.id).toBe('y');
    expect(store.get('nope')).toBeNull();
  });
});
