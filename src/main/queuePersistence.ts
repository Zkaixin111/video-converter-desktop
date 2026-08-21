/**
 * 队列快照存储的单例装配（这里才允许 import electron）。
 *
 * 与 `HistoryStore` 同样的分法：纯逻辑在 core/job 下能被单测直接 new，
 * 路径解析要 `app.getPath('userData')`，这件事留在 main 层。
 */
import { app } from 'electron';
import path from 'node:path';
import { QueuePersistence } from './core/job/queuePersistence';

let instance: QueuePersistence | null = null;

export function queuePersistence(): QueuePersistence {
  if (!instance) {
    instance = new QueuePersistence(path.join(app.getPath('userData'), 'queue.json'));
  }
  return instance;
}
