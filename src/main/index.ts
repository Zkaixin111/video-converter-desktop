import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { verifyBinaries } from './core/ffmpeg/paths';
import { jobManager } from './core/job/JobManager';
import { registerAllIpc } from './ipc';
import { logger } from './logger';

/**
 * 构建产物结构（由 vite-plugin-electron 决定，配置见 vite.config.ts）
 *
 * ```tree
 * ├── dist/                 渲染进程静态资源（由 src/renderer 构建而来）
 * │   └── index.html
 * └── dist-electron/        主进程 + preload
 *     ├── main.cjs          本文件
 *     └── preload.cjs       预加载脚本（CJS，sandbox 模式要求）
 * ```
 *
 * 主进程产物是 CJS，所以 `__dirname` 可直接使用，指向 `dist-electron/`。
 */
const APP_ROOT = path.join(__dirname, '..');
const RENDERER_DIST = path.join(APP_ROOT, 'dist');
const PRELOAD_FILE = path.join(__dirname, 'preload.cjs');

/** 开发态由 vite-plugin-electron 注入；打包态为 undefined */
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// Windows 任务栏图标归组需要，须与 electron-builder.json5 的 appId 保持一致
app.setAppUserModelId('com.zkaixin.videoconverter');

let win: BrowserWindow | null = null;

const getWindow = (): BrowserWindow | null => win;

function createWindow(): void {
  win = new BrowserWindow({
    // 窗口尺寸与《UI设计规范》§3 一致：默认 1080×720，最小 860×600
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 600,
    show: false,
    // 无边框 + 自绘标题栏（原型 #titlebar 有三个自绘窗口按钮）。
    // 若用系统边框，界面里会同时出现两套最小化/关闭按钮。
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#F7F8FA',
    title: '视频转换器',
    webPreferences: {
      // sandbox 模式下 preload 必须是 CJS，故这里是 preload.cjs
      preload: PRELOAD_FILE,
      // —— 安全基线，不可放宽 ——
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // 转码时窗口可能失焦，禁止后台节流，否则进度推送与定时器会被压慢
      backgroundThrottling: false,
    },
  });

  // 等首帧渲染完再显示，避免白屏闪烁
  win.once('ready-to-show', () => win?.show());

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  // 渲染进程不得自行开新窗口，外链一律交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    win = null;
  });
}

// 单实例：重复启动时聚焦已有窗口，而不是开第二个
// （两个实例同时跑 ffmpeg 会抢 CPU，配置写入也会互相覆盖）
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on('window-all-closed', () => {
    // macOS 上关闭窗口不退出应用，这是平台惯例
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // 退出前杀掉 ffmpeg，否则关掉窗口后它还在后台跑（用户会在任务管理器里发现）
  app.on('before-quit', () => {
    void jobManager.dispose();
  });

  app.whenReady().then(async () => {
    registerAllIpc(getWindow);

    // 自检不阻断启动：缺 ffmpeg 时主界面进引导态，而不是打不开
    const check = await verifyBinaries().catch((err) => {
      logger.error('binary check failed', err);
      return null;
    });
    if (check) {
      logger.info('binaries', {
        ok: check.ok,
        version: check.version,
        hasLibx264: check.hasLibx264,
        missing: check.missing,
      });
      if (!check.ok) logger.warn('缺少转换组件，界面将进入引导态');
    }

    createWindow();
  });
}
