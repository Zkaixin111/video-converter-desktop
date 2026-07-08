/**
 * 应用外壳：自绘标题栏 + 侧边栏 + 内容区 + Toast。
 *
 * 页面切换策略与原型一致：**不做整页转场**，
 * 内容区先 150ms 淡出，换页后再淡入；切换中不改变窗口尺寸、不抖动。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { cn } from './lib/cn';
import { useFileDrop } from './hooks/useFileDrop';
import { useAppStore, type Page } from './store/useAppStore';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { IconSprite } from './components/ui/Icon';
import { ToastStack } from './components/ui/Toast';
import { ConvertPage } from './pages/ConvertPage';
import { QueuePage } from './pages/QueuePage';
import { PresetsPage } from './pages/PresetsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AboutPage } from './pages/AboutPage';

const PAGES: Record<Page, () => ReactElement> = {
  convert: ConvertPage,
  queue: QueuePage,
  presets: PresetsPage,
  settings: SettingsPage,
  about: AboutPage,
};

export default function App(): ReactElement {
  const page = useAppStore((s) => s.page);
  const stage = useAppStore((s) => s.stage);
  const density = useAppStore((s) => s.settings?.density ?? 'normal');
  const version = useAppStore((s) => s.caps?.app.version ?? '0.1.0');
  const init = useAppStore((s) => s.init);
  const setPage = useAppStore((s) => s.setPage);

  const dragging = useFileDrop();
  const [switching, setSwitching] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const switchTimer = useRef<number | null>(null);

  // 一次性初始化：自检 + 设置 + 订阅主进程事件（store 内部有幂等保护）
  useEffect(() => {
    void init();
  }, [init]);

  // Esc 取消转换（与原型一致）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const s = useAppStore.getState();
      if (s.stage === 'running') void s.cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(
    () => () => {
      if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
    },
    [],
  );

  const navigate = (next: Page): void => {
    if (next === page) return;
    setSwitching(true);
    if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
    switchTimer.current = window.setTimeout(() => {
      setPage(next);
      contentRef.current?.scrollTo({ top: 0 });
      setSwitching(false);
    }, 150);
  };

  const Current = PAGES[page];

  return (
    <div className={cn('win', density === 'compact' && 'density-compact', dragging && 'is-dragover')}>
      <IconSprite />
      <TitleBar />

      <div className="win-body">
        <Sidebar current={page} version={version} onNavigate={navigate} />

        <div ref={contentRef} className={cn('content', switching && 'is-switching')}>
          <Current />
        </div>
      </div>

      <ToastStack />

      {/* 转换中离开转换页时给一个可点回的角标，避免「任务消失了」的错觉 */}
      {stage === 'running' && page !== 'convert' ? (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 20 }}
          onClick={() => navigate('convert')}
        >
          转换进行中 · 查看
        </button>
      ) : null}
    </div>
  );
}
