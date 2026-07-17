/** IPC 注册总入口：一处调用，所有通道生效 */
import type { BrowserWindow } from 'electron';
import { registerAppIpc } from './app';
import { registerConvertIpc } from './convert';
import { registerHistoryIpc } from './history';
import { registerMediaIpc } from './media';
import { registerQueueIpc } from './queue';
import { registerShellIpc } from './shell';

export function registerAllIpc(getWindow: () => BrowserWindow | null): void {
  registerMediaIpc();
  // queue 先注册：它要先把 jobManager 的事件接收方与运行期依赖装配好，
  // 否则第一次入队时事件会没有接收方（进度就推不出去）。
  registerQueueIpc(getWindow);
  registerConvertIpc();
  registerShellIpc(getWindow);
  registerAppIpc(getWindow);
  registerHistoryIpc();
}
