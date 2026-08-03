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
      const obj = requireObject(payload, 'payload');
      const p = requireAbsPath(obj.path, 'path');
      // 引导态要用户把二进制放进一个「还没建出来的目录」，
      // 这时打开失败是产品造成的，不是用户操作错了 —— 所以允许顺手建出来。
      const mkdir = obj.mkdir === true;

      let stat = await fs.stat(p).catch(() => null);
      if (!stat && mkdir) {
        await fs.mkdir(p, { recursive: true });
        stat = await fs.stat(p).catch(() => null);
      }
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

  /**
   * 选视频。`multi` 决定是否允许多选（队列页的「添加文件」用多选）。
   *
   * 返回值同时给 `path`（首个，兼容 MVP 的单选调用方）与 `paths`（全部），
   * 这样老的 `const { path } = await selectVideo()` 完全不用改。
   */
  ipcMain.handle(CH.selectVideo, (_e, payload: unknown) =>
    wrap<{ path: string | null; paths: string[] }>(async () => {
      const win = getWindow();
      const multi = Boolean((payload as { multi?: boolean } | undefined)?.multi);
      const properties: Array<'openFile' | 'multiSelections'> = multi
        ? ['openFile', 'multiSelections']
        : ['openFile'];
      const options = {
        title: multi ? '选择视频文件（可多选）' : '选择视频文件',
        properties,
        filters: VIDEO_FILTERS,
      };
      const res = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      const paths = res.canceled ? [] : res.filePaths;
      return { path: paths[0] ?? null, paths };
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
