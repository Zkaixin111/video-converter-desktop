/**
 * 系统通知（TODO-08）。
 *
 * 只有一件事：批次结束时弹一条，点一下把窗口叫回来。
 *
 * 两个平台坑，都在这里一次性处理掉：
 *   · Windows 上必须先 `app.setAppUserModelId('...')`，否则通知**静默丢失**
 *     —— 代码不报错、也不弹，只有打包后才会被发现。调用点在 main/index.ts。
 *   · 通知是「发后不管」的：show() 之后不要持有引用等它，
 *     但在被 GC 前 click 回调必须还在，所以这里把对象挂在窗口的 click 里闭包住。
 */
import { Notification, type BrowserWindow } from 'electron';
import type { NotifyText } from '../shared/notify';

export function notifyFinished(
  getWindow: () => BrowserWindow | null,
  text: NotifyText,
): void {
  try {
    if (!Notification.isSupported()) return;

    const notification = new Notification({
      title: text.title,
      body: text.body,
      // 不发声：转码是后台活儿，突然响一声会把人吓一跳
      silent: true,
    });

    // 点击通知 = 把界面叫到前台（用户点它就是想看结果）
    notification.on('click', () => {
      const win = getWindow();
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
    });

    notification.show();
  } catch {
    /* 通知是锦上添花，弹不出来也不能影响转换 */
  }
}
