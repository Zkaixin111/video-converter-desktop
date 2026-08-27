/**
 * 系统托盘（TODO-14）。
 *
 * 三件事：**藏得下去、看得见进度、退得干净**。
 *
 * 1. 关窗改成隐藏而不是退出（在主进程 close 事件里拦），转码照常跑；
 * 2. tooltip 显示 `3/10 · 45%`，菜单里给「显示主窗口 / 暂停队列 / 退出」；
 * 3. 「退出」是**唯一**的退出入口，它走 `app.quit()`，由 `before-quit` 统一
 *    杀掉 ffmpeg 子进程 —— 藏起来的时候可没有「关掉最后一个窗口」这条路。
 *
 * 队列快照以外的任何状态都不在这里存：tooltip 与菜单每次都从 JobManager 重算，
 * 这样等界面被隐藏、Renderer 不再更新时，托盘看到的仍然是真实进度。
 */
import { Menu, Tray } from 'electron';
import { traySummary, type TraySummary } from '../shared/queue';
import { jobManager } from './core/job/JobManager';
import { onQueueChanged } from './ipc/queue';
import { logger } from './logger';
import { createTrayImage } from './trayIcon';

const APP_NAME = '视频转换器';

export interface TrayDeps {
  /** 把窗口叫回前台；窗口已经销毁了就重建一个 */
  focusWindow: () => void;
  /** 真正的退出：调用方负责先立标志位再 app.quit() */
  requestQuit: () => void;
}

let tray: Tray | null = null;
/** 「已藏到托盘」的提示每次启动只弹一次：它是教学提示，不是通知班组 */
let balloonShown = false;

export function createTray(deps: TrayDeps): Tray | null {
  if (tray) return tray;

  try {
    tray = new Tray(createTrayImage());
  } catch (err) {
    // 托盘不是必需品：某些 Linux 桌面与远程会话里根本没有通知区，
    // 画不出来也不能拖垮启动 —— 没有它就退回「关窗即退出」的语义
    logger.warn('tray unavailable', String(err));
    return null;
  }

  tray.setToolTip(APP_NAME);
  // Windows / macOS 上单击 = 唤出窗口；Linux 常见的是单击弹菜单，两边都留个出口
  tray.on('click', () => deps.focusWindow());
  tray.on('double-click', () => deps.focusWindow());

  const refresh = (): void => {
    if (!tray || tray.isDestroyed()) return;
    try {
      const summary = traySummary(jobManager.list(), APP_NAME);
      tray.setToolTip(summary.tooltip);
      tray.setContextMenu(buildMenu(deps, summary));
    } catch (err) {
      logger.warn('tray refresh failed', String(err));
    }
  };

  refresh();
  onQueueChanged(refresh);
  return tray;
}

/** 托盘真的立起来了吗 —— 没有它就不能把「关窗」拦下来，否则程序永远退不掉 */
export function hasTray(): boolean {
  return tray !== null;
}

/** 退出前销毁：不 destroy 的话，Windows 上偶尔会留下一个点不动的残影图标 */
export function destroyTray(): void {
  if (!tray) return;
  try {
    tray.destroy();
  } catch {
    /* 销毁失败不影响退出本身 */
  }
  tray = null;
}

/**
 * 第一次藏进托盘时解释一下「窗口没了但活儿还在」。
 *
 * 这句话回答的是最直接的疑虑，所以它**只在真的有任务在跑时**出现：
 * 什么都没转的时候也弹，就纯粹是骚扰了。
 */
export function notifyTrayOnce(): void {
  if (!tray || tray.isDestroyed() || balloonShown) return;
  if (!jobManager.isBusy()) return;
  // displayBalloon 是 Windows 专有，macOS / Linux 上不存在
  if (typeof tray.displayBalloon !== 'function') return;

  balloonShown = true;
  try {
    tray.displayBalloon({
      title: '还在后台转换',
      content: `窗口已经藏到托盘${outletHint()}，转换不会中断。`,
      icon: createTrayImage(),
      noSound: true,
    });
  } catch (err) {
    logger.warn('tray balloon failed', String(err));
  }
}

function outletHint(): string {
  return process.platform === 'win32' ? '（右下角）' : '';
}

function buildMenu(deps: TrayDeps, s: TraySummary): Menu {
  return Menu.buildFromTemplate([
    { label: s.statusLine, enabled: false },
    { type: 'separator' },
    { label: '显示主窗口', click: () => deps.focusWindow() },
    s.paused
      ? { label: '继续队列', enabled: s.live, click: () => void jobManager.resume() }
      : { label: '暂停队列', enabled: s.live, click: () => void jobManager.pause() },
    { type: 'separator' },
    { label: '退出', click: () => deps.requestQuit() },
  ]);
}
