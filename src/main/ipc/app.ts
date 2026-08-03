/** app:* / window:* —— 能力自检、设置、剪贴板、窗口控制 */
import { BrowserWindow, clipboard, ipcMain, nativeTheme } from 'electron';
import { CH, type WindowAction } from '../../shared/channels';
import { AppError } from '../../shared/errors';
import type { Capabilities, Settings } from '../../shared/types';
import { windowBackgroundOf } from '../../shared/theme';
import { toCapabilities, verifyBinaries } from '../core/ffmpeg/paths';
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
