/** shell:* / dialog:* —— 文件对话框与系统外壳 */
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CH } from '../../shared/channels';
import { AppError } from '../../shared/errors';
import { requireAbsPath, requireObject, requireString, wrap } from './wrap';

const VIDEO_FILTERS = [
  { name: '视频文件', extensions: ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'webm', 'mpg', 'mpeg', 'ts', 'm4v', 'rmvb', '3gp'] },
  { name: '所有文件', extensions: ['*'] },
];

export function registerShellIpc(getWindow: () => BrowserWindow | null): void {
  /** 传文件 → 在资源管理器中选中它；传目录 → 直接打开 */
  ipcMain.handle(CH.openFolder, (_e, payload: unknown) =>
    wrap<{ ok: boolean }>(async () => {
      const { path: target } = requireObject(payload, 'payload');
      const p = requireAbsPath(target, 'path');

      const stat = await fs.stat(p).catch(() => null);
      if (!stat) throw new AppError('E_FILE_NOT_FOUND', '这个路径已经不存在了。', { detail: p });

      if (stat.isDirectory()) {
        const err = await shell.openPath(p);
        if (err) throw new AppError('E_PERMISSION', '无法打开这个文件夹。', { detail: err });
        return { ok: true };
      }
      shell.showItemInFolder(p);
      return { ok: true };
    }),
  );

  ipcMain.handle(CH.selectOutputDir, () =>
    wrap<{ path: string | null }>(async () => {
      const win = getWindow();
      const res = win
        ? await dialog.showOpenDialog(win, {
            title: '选择输出文件夹',
            properties: ['openDirectory', 'createDirectory'],
          })
        : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      return { path: res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0] };
    }),
  );

  ipcMain.handle(CH.selectVideo, () =>
    wrap<{ path: string | null }>(async () => {
      const win = getWindow();
      const options = {
        title: '选择视频文件',
        properties: ['openFile' as const],
        filters: VIDEO_FILTERS,
      };
      const res = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      return { path: res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0] };
    }),
  );

  /** 只放行 http/https：渲染进程不能借 openExternal 打开任意协议 */
  ipcMain.handle(CH.openExternal, (_e, payload: unknown) =>
    wrap<{ ok: boolean }>(async () => {
      const { url } = requireObject(payload, 'payload');
      const u = requireString(url, 'url');
      let parsed: URL;
      try {
        parsed = new URL(u);
      } catch {
        throw new AppError('E_BAD_REQUEST', '链接格式不正确。');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new AppError('E_BAD_REQUEST', '只允许打开 http/https 链接。');
      }
      await shell.openExternal(u);
      return { ok: true };
    }),
  );
}

/** 供其它模块复用：在资源管理器中定位文件 */
export function revealFile(filePath: string): void {
  shell.showItemInFolder(path.normalize(filePath));
}
