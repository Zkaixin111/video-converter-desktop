/**
 * 终态任务快照 → 历史条目（TODO-07）。
 *
 * 独立成纯函数是为了能直接单测：历史是「失败也要记」的台账，
 * 「哪些状态该记、没结果时字段怎么填」这些分支写散在 IPC 里根本测不到。
 *
 * 三条规则：
 *   1. 只有终态才记：preparing / running 的进度事件不该污染历史
 *   2. `done` 必须有 result —— 没有结果却记一条「成功」是自相矛盾
 *   3. 失败/取消没有 result，输出相关的字段一律按空/0 填，界面据此隐藏「打开」
 */
import type { HistoryEntry, HistoryStatus, JobSnapshot } from './types';

export function historyStatusOf(s: JobSnapshot['status']): HistoryStatus | null {
  if (s === 'done') return 'done';
  if (s === 'cancelled') return 'cancelled';
  if (s === 'error') return 'failed';
  return null;
}

export function toHistoryEntry(s: JobSnapshot, finishedAt: number): HistoryEntry | null {
  if (!s.jobId) return null;
  const status = historyStatusOf(s.status);
  if (!status) return null;
  if (status === 'done' && !s.result) return null;

  return {
    id: s.jobId,
    fileName: s.fileName ?? '',
    sourcePath: s.sourcePath ?? '',
    outputPath: s.result?.outputPath ?? '',
    target: s.target ?? 'mp4',
    mode: s.result?.mode ?? 'transcode',
    preset: s.preset ?? 'standard',
    audio: s.audio ?? null,
    sourceSizeBytes: s.result?.sourceSizeBytes ?? s.sourceSizeBytes ?? 0,
    outputSizeBytes: s.result?.outputSizeBytes ?? 0,
    elapsedMs: s.result?.elapsedMs ?? 0,
    verified: s.result?.verified ?? false,
    finishedAt,
    status,
    error: s.error ? { code: s.error.code, message: s.error.message } : undefined,
  };
}
