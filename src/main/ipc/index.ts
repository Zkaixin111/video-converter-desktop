/** IPC 注册总入口：一处调用，所有通道生效 */
import type { BrowserWindow } from 'electron';
import { registerAppIpc } from './app';
import { registerConvertIpc } from './convert';
import { registerMediaIpc } from './media';
import { registerShellIpc } from './shell';

export function registerAllIpc(getWindow: () => BrowserWindow | null): void {
  registerMediaIpc();
  registerConvertIpc(getWindow);
  registerShellIpc(getWindow);
  registerAppIpc(getWindow);
}
