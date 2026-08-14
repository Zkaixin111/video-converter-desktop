/** app:* / window:* —— 能力自检、设置、剪贴板、窗口控制、日志与诊断包 */
import fs from 'node:fs';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
} from 'electron';
import { CH, type WindowAction } from '../../shared/channels';
import { AppError } from '../../shared/errors';
import type { Capabilities, Settings } from '../../shared/types';
import { windowBackgroundOf } from '../../shared/theme';
import { toCapabilities, verifyBinaries } from '../core/ffmpeg/paths';
import { buildDiagnosticEntries, diagnosticFileName } from '../core/fs/diagnostics';
import { createZip } from '../core/fs/zip';
import { historyStore } from '../history';
import { logger } from '../logger';
import { getSettings, updateSettings } from '../store';
import { requireObject, requireString, wrap } from './wrap';

export function registerAppIpc(getWindow: () => BrowserWindow | null): void {
  /**
   * 启动自检：结果在 paths.ts 里缓存。
   * `recheck: true` 时强制重新探测（引导态里用户手动放好 ffmpeg.exe 后点「重新检测」）。
   */
  ipcMain.handle(CH.capabilities, (_e, payload: unknown) =>
    wrap<Capabilities>(async () => {
      const recheck = (payload as { recheck?: boolean } | undefined)?.recheck === true;
      return toCapabilities(await verifyBinaries(recheck));
    }),
  );

  ipcMain.handle(CH.getSettings, () => wrap<Settings>(() => getSettings()));

  ipcMain.handle(CH.setSettings, (_e, payload: unknown) =>
    wrap<Settings>(() => {
      const { patch } = requireObject(payload, 'payload');
      const p = requireObject(patch, 'patch');
      const next = updateSettings(p as Partial<Settings>);
      // 原生窗口与系统对话框也要跟上：否则会出现「界面是深色、打开文件对话框是白的」
      if (next.theme) nativeTheme.themeSource = next.theme;
      return next;
    }),
  );

  ipcMain.handle(CH.copyText, (_e, payload: unknown) =>
    wrap<{ ok: boolean }>(() => {
      const { text } = requireObject(payload, 'payload');
      clipboard.writeText(requireString(text, 'text'));
      return { ok: true };
    }),
  );

  /**
   * 打开日志所在目录（TODO-11）。
   *
   * 「设置里能看到日志」的价值不在于让用户天天去看，
   * 而在于他报问题时能一键拿到现场，而不是对着 toast 截图。
   */
  ipcMain.handle(CH.openLogs, () =>
    wrap<{ ok: boolean }>(() => {
      const file = logger.getLogFilePath();
      if (!file || !fs.existsSync(file)) {
        throw new AppError('E_FILE_NOT_FOUND', '还没有产生任何日志。', {
          hint: '进行一次转换之后这里就会有记录。',
        });
      }
      shell.showItemInFolder(file);
      return { ok: true };
    }),
  );

  /** 某个任务的日志片段：报问题时只需要「这一次」的，不是整份日志 */
  ipcMain.handle(CH.jobLog, (_e, payload: unknown) =>
    wrap<{ lines: string[] }>(() => {
      const { jobId } = requireObject(payload, 'payload');
      return { lines: logger.linesFor(requireString(jobId, 'jobId')).slice(-50) };
    }),
  );

  /**
   * 导出诊断包（TODO-11）。
   *
   * 让用户自己选保存位置：诊断包是要发给别人的，
   * 默认塞进 userData 还得他再去找一遍。
   */
  ipcMain.handle(CH.exportDiagnostics, () =>
    wrap<{ path: string | null }>(async () => {
      const now = Date.now();
      // 自检可能失败（引擎缺失），但诊断包恰恰要记录「引擎缺失」这件事
      const caps = await verifyBinaries(false).then(toCapabilities).catch(() => null);

      const entries = buildDiagnosticEntries({
        settings: getSettings(),
        capabilities: caps ?? null,
        history: historyStore().list().slice(0, 50),
        logs: logger.snapshot(),
        appVersion: app.getVersion(),
        now,
      });

      const defaultPath = diagnosticFileName(now);
      const win = getWindow();
      const res = win
        ? await dialog.showSaveDialog(win, {
            title: '导出诊断包',
            defaultPath,
            filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
          })
        : await dialog.showSaveDialog({
            title: '导出诊断包',
            defaultPath,
            filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
          });
      if (res.canceled || !res.filePath) return { path: null };

      fs.writeFileSync(res.filePath, createZip(entries));
      logger.info('diagnostics exported', res.filePath);
      return { path: res.filePath };
    }),
  );

  ipcMain.handle(CH.windowControl, (_e, payload: unknown) =>
    wrap<{ ok: boolean }>(() => {
      const { action } = requireObject(payload, 'payload');
      const a = requireString(action, 'action') as WindowAction;
      const win = getWindow();
      if (!win) throw new AppError('E_BAD_REQUEST', '窗口不可用。');

      switch (a) {
        case 'minimize':
          win.minimize();
          break;
        case 'maximize':
          if (win.isMaximized()) win.unmaximize();
          else win.maximize();
          break;
        case 'close':
          win.close();
          break;
        default:
          throw new AppError('E_BAD_REQUEST', `未知的窗口操作：${a}`);
      }
      return { ok: true };
    }),
  );
}

export function isMaximized(win: BrowserWindow | null): boolean {
  return win?.isMaximized() ?? false;
}

/** 启动时把主题同步给原生层（渲染层自己会读设置，这里只管 nativeTheme） */
export function applyNativeTheme(): void {
  try {
    nativeTheme.themeSource = getSettings().theme ?? 'light';
  } catch {
    /* 主题不该挡住启动 */
  }
}

/** 供 main/index.ts 在创建窗口时取背景色，避免深色用户看到一帧白闪 */
export function windowBackgroundColor(): string {
  try {
    return windowBackgroundOf(getSettings().theme, nativeTheme.shouldUseDarkColors);
  } catch {
    /* 取不到就用浅色 */
  }
  return windowBackgroundOf('light', false);
}
