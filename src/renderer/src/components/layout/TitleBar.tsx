/**
 * 自绘标题栏（窗口 frame: false）。
 *
 * 40px 高、左侧应用图标 + 名称、右侧三个窗口按钮，
 * 整条标题栏 `-webkit-app-region: drag` 可拖动，按钮区单独设回 no-drag。
 * 双击标题栏最大化由 Windows 原生处理，不用自己写。
 */
import type { ReactElement } from 'react';
import { Icon } from '../ui/Icon';

export function TitleBar(): ReactElement {
  const control = (action: 'minimize' | 'maximize' | 'close') => {
    // 窗口操作失败无需打扰用户（例如关闭时窗口已经销毁）
    void window.api.windowControl(action);
  };

  return (
    <div className="titlebar">
      <div className="app-ico">
        <Icon name="i-convert" />
      </div>
      <span className="app-name">视频转换器</span>
      <div className="spacer" />
      <div className="win-ctrl">
        <button type="button" title="最小化" onClick={() => control('minimize')}>
          <Icon name="i-minus" />
        </button>
        <button type="button" title="最大化" onClick={() => control('maximize')}>
          <Icon name="i-square" />
        </button>
        <button type="button" className="close" title="关闭" onClick={() => control('close')}>
          <Icon name="i-x" />
        </button>
      </div>
    </div>
  );
}
