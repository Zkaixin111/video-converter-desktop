/**
 * 终态快照 → 历史条目（TODO-07）。
 *
 * 这里钉死的是两条边界：
 *   1. **只有终态才记**：preparing / running 的进度事件绝不能落历史，
 *      否则一个文件会在历史里留下一串「未完成」的同名记录
 *   2. **成功必须有 result**：没有结果却记一条「成功」是自相矛盾，
 *      宁可不记也不要记一条打不开的假成功
 */
import { describe, expect, it } from 'vitest';
import { toHistoryEntry } from '../../src/shared/history';
import type { JobSnapshot } from '../../src/shared/types';

const base: JobSnapshot = {
  status: 'done',
  jobId: 'job-1',
  fileName: 'a.mp4',
  sourcePath: 'C:/in/a.mp4',
  target: 'mkv',
  preset: 'high',
  sourceSizeBytes: 2048,
  result: {
    jobId: 'job-1',
    outputPath: 'C:/out/a_converted.mkv',
    outputSizeBytes: 1024,
    sourceSizeBytes: 2048,
    elapsedMs: 3000,
    mode: 'transcode',
    verified: true,
  },
};

describe('toHistoryEntry · 只记终态', () => {
  it('preparing / running 不落历史', () => {
    expect(toHistoryEntry({ ...base, status: 'preparing' }, 1)).toBeNull();
    expect(toHistoryEntry({ ...base, status: 'running' }, 1)).toBeNull();
  });

  it('idle 也不落历史（空快照）', () => {
    expect(toHistoryEntry({ status: 'idle' }, 1)).toBeNull();
  });

  it('没有 jobId 的快照不落历史', () => {
    expect(toHistoryEntry({ ...base, jobId: undefined }, 1)).toBeNull();
  });
});

describe('toHistoryEntry · 成功', () => {
  it('带 result 的记录字段完整，档位一并存下（重跑要用）', () => {
    const got = toHistoryEntry(base, 1_700_000_000_000);
    expect(got).toMatchObject({
      id: 'job-1',
      status: 'done',
      target: 'mkv',
      preset: 'high',
      outputPath: 'C:/out/a_converted.mkv',
      outputSizeBytes: 1024,
      verified: true,
      finishedAt: 1_700_000_000_000,
    });
    expect(got?.error).toBeUndefined();
  });

  it('done 但没 result 时宁可不记，也不记一条假成功', () => {
    expect(toHistoryEntry({ ...base, result: undefined }, 1)).toBeNull();
  });
});

describe('toHistoryEntry · 失败与取消', () => {
  it('失败记录带上错误码，输出字段留空', () => {
    const got = toHistoryEntry(
      {
        ...base,
        status: 'error',
        result: undefined,
        error: { code: 'E_DISK_FULL', message: '输出磁盘空间不足。' },
      },
      1,
    );
    expect(got).toMatchObject({
      status: 'failed',
      outputPath: '',
      outputSizeBytes: 0,
      elapsedMs: 0,
      verified: false,
      error: { code: 'E_DISK_FULL', message: '输出磁盘空间不足。' },
    });
  });

  it('取消记录没有 error 也能存（取消不是错误）', () => {
    const got = toHistoryEntry({ ...base, status: 'cancelled', result: undefined }, 1);
    expect(got).toMatchObject({ status: 'cancelled', outputPath: '', sourceSizeBytes: 2048 });
    expect(got?.error).toBeUndefined();
  });

  it('失败时来源体积取自快照（没有 result 也要知道源文件多大）', () => {
    const got = toHistoryEntry(
      { ...base, status: 'error', result: undefined, sourceSizeBytes: 4096 },
      1,
    );
    expect(got?.sourceSizeBytes).toBe(4096);
  });
});

/**
 * 音频提取的历史（TODO-20）。
 *
 * 关键在**重跑**：音频记录的 `target` 是入队时的全局容器（比如 mp4），
 * 真正决定输出的是 `audio`。重跑若只看 target，就会「本来抽的是 MP3，重跑却转出 MP4」。
 */
describe('toHistoryEntry · 音频提取', () => {
  it('快照带 audio 时一并存下', () => {
    const got = toHistoryEntry({ ...base, audio: 'mp3' }, 1);
    expect(got?.audio).toBe('mp3');
  });

  it('视频任务的 audio 一律为 null（界面据此区分两条路线）', () => {
    expect(toHistoryEntry(base, 1)?.audio).toBeNull();
    expect(toHistoryEntry({ ...base, audio: null }, 1)?.audio).toBeNull();
  });

  it('音频提取失败也带上 audio——失败记录同样要能按原路重跑', () => {
    const got = toHistoryEntry(
      { ...base, status: 'error', result: undefined, audio: 'm4a' },
      1,
    );
    expect(got).toMatchObject({ status: 'failed', audio: 'm4a' });
  });
});
