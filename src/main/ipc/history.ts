/**
 * history:* —— 转换历史的读取、清理与「一键重跑」。
 *
 * 写入不在这里：终态回调统一由 queue 的 onState 落库（成功/失败/取消都记，TODO-07）。
 *
 * 重跑的关键约束是**必须按原参数**：用户在队列里改成 WebM 转过一次，
 * 之后又把全局格式切回 MP4，点「重跑」仍然要出 WebM ——
 * 否则「重跑」就变成了「换个参数再来一次」，失败记录也就失去了回看的意义。
 */
import fs from 'node:fs';
import { ipcMain } from 'electron';
import { CH } from '../../shared/channels';
import { AppError } from '../../shared/errors';
import type { HistoryEntry, HistoryItem, QueueItem } from '../../shared/types';
import { probeMedia } from '../core/ffmpeg/probe';
import { jobManager } from '../core/job/JobManager';
import { historyStore } from '../history';
import { logger } from '../logger';
import { requireObject, requireString, wrap } from './wrap';

/** 现场判定源文件还在不在：这一步只在读列表时做，绝不上盘 */
function withSourceFlag(entry: HistoryEntry): HistoryItem {
  let sourceExists = false;
  try {
    sourceExists = fs.existsSync(entry.sourcePath);
  } catch {
    /* 路径非法/权限异常都按「不在了」处理 —— 反正也重跑不了 */
  }
  return { ...entry, sourceExists };
}

export function registerHistoryIpc(): void {
  ipcMain.handle(CH.historyList, () =>
    wrap<HistoryItem[]>(() => historyStore().list().map(withSourceFlag)),
  );

  ipcMain.handle(CH.historyRemove, (_e, payload: unknown) =>
    wrap<HistoryItem[]>(() => {
      const { id } = requireObject(payload, 'payload');
      return historyStore().remove(requireString(id, 'id')).map(withSourceFlag);
    }),
  );

  ipcMain.handle(CH.historyClear, () =>
    wrap<{ ok: boolean }>(() => {
      historyStore().clear();
      return { ok: true };
    }),
  );

  /**
   * 一键重跑：按记录里的 target + preset 重新入队。
   *
   * 参数直接固化成 custom（而不是走全局）：重跑语义就是「照原样再来一次」，
   * 固化后即使当前处于「共用全局参数」模式，队列里也能看出这条自带参数。
   */
  ipcMain.handle(CH.historyRerun, (_e, payload: unknown) =>
    wrap<QueueItem[]>(async () => {
      const { id } = requireObject(payload, 'payload');
      const entry = historyStore().get(requireString(id, 'id'));
      if (!entry) {
        throw new AppError('E_BAD_REQUEST', '这条记录已经不在了，可能已被清空。');
      }
      if (!fs.existsSync(entry.sourcePath)) {
        throw new AppError(
          'E_FILE_NOT_FOUND',
          `源文件不在原位置了，无法重跑：${entry.sourcePath}`,
          { hint: '把文件放回原处，或直接在转换页重新选择它。' },
        );
      }

      // 重新探测：文件可能被换过内容（同名不同片），沿用旧 meta 会算出错的转码参数
      const meta = await probeMedia(entry.sourcePath);
      const [first] = jobManager.enqueue([
        {
          meta,
          target: entry.target,
          preset: entry.preset,
          custom: { target: entry.target, preset: entry.preset },
          outputDir: null,
        },
      ]);
      if (!first) {
        throw new AppError('E_UNKNOWN', '重跑入队失败，请重试。');
      }

      logger.info('history rerun', entry.id, entry.fileName, '→', entry.target);
      return [first.item];
    }),
  );
}
