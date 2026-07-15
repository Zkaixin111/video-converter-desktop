/** history:* —— 转换历史的读取与清理（写入由 convert:start 的终态回调负责） */
import { ipcMain } from 'electron';
import { CH } from '../../shared/channels';
import type { HistoryEntry } from '../../shared/types';
import { historyStore } from '../history';
import { requireObject, requireString, wrap } from './wrap';

export function registerHistoryIpc(): void {
  ipcMain.handle(CH.historyList, () => wrap<HistoryEntry[]>(() => historyStore().list()));

  ipcMain.handle(CH.historyRemove, (_e, payload: unknown) =>
    wrap<HistoryEntry[]>(() => {
      const { id } = requireObject(payload, 'payload');
      return historyStore().remove(requireString(id, 'id'));
    }),
  );

  ipcMain.handle(CH.historyClear, () =>
    wrap<{ ok: boolean }>(() => {
      historyStore().clear();
      return { ok: true };
    }),
  );
}
