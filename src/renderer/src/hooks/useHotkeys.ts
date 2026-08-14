/**
 * 全局快捷键（TODO-09）。
 *
 * 挂载在 App 上，因此各页面通用；但**每个键只在该有意义的页面生效**——
 * 在设置页按 Ctrl+Enter 不该启动任何东西。
 *
 * 两条边界：
 *   1. **输入框里不劫持按键**：用户在改「输出命名模板」时敲 Esc，
 *      是想撤掉输入，不是想取消后台任务。Ctrl+Enter 例外——
 *      它在文本输入里没有任何默认含义，抢过来做「开始转换」是安全的。
 *   2. **用 getState() 而不是订阅**：快捷键回调每次都要读最新的页面与阶段，
 *      订阅会让这个 effect 随状态变化反复解绑重绑。
 */
import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';

/** 焦点在可输入元素里吗？ */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export function useHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const s = useAppStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const typing = isTyping(e.target);

      // 不带修饰键的 Esc 在输入框里属于用户，是「撤掉这次输入」
      if (typing && !(mod && e.key === 'Enter')) return;

      // 打开任务队列：任何页面都该能用（批量场景它是归宿）
      if (mod && e.shiftKey && (e.key === 'Q' || e.key === 'q')) {
        e.preventDefault();
        s.setPage('queue');
        return;
      }

      if (mod && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        // 转换页是「组装区」——选完进批次；别处直接入队，那才是它们的目的
        if (s.page === 'convert') void s.pickIntoBatch(true);
        else void s.pickFiles();
        return;
      }

      if (mod && e.key === 'Enter') {
        // 只有在转换页且已组装好批次时才有意义
        if (s.page !== 'convert' || s.stage !== 'setup') return;
        e.preventDefault();
        void s.start();
        return;
      }

      if (e.key === 'Escape') {
        if (s.page !== 'convert' || s.stage !== 'running') return;
        e.preventDefault();
        void s.cancel();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
