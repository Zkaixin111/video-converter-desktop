/**
 * 历史存储的单例装配（这里才允许 import electron）。
 *
 * core/job/history.ts 保持纯 Node 是为了能被单测直接 new，
 * 路径解析需要 app.getPath 时在 vitest 里会抛 —— 所以把这两件事分开。
 */
import { app } from 'electron';
import path from 'node:path';
import { HistoryStore } from './core/job/history';

let instance: HistoryStore | null = null;

export function historyStore(): HistoryStore {
  if (!instance) {
    instance = new HistoryStore(path.join(app.getPath('userData'), 'history.json'));
  }
  return instance;
}
