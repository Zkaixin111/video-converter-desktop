/**
 * 主题应用（TODO-06）。
 *
 * 三选一的语义：
 *   · light / dark  —— 固定
 *   · system        —— 跟随系统，且系统主题切换时**立即**跟着变（不用重启）
 *
 * 只改 `<html data-theme>` 一个属性：CSS 里所有深色 Token 都挂在
 * `[data-theme='dark']` 上，Tailwind 工具类引用的是同一批变量，所以不会有漏网的组件。
 *
 * 折算逻辑本身在 shared/theme.ts —— 主进程建窗口时要先算出底色，用的是同一个函数。
 */
import { useLayoutEffect } from 'react';
import { resolveTheme } from '../../../shared/theme';
import { useAppStore } from '../store/useAppStore';

/** 系统当前偏好深色？无 matchMedia 的老环境一律按浅色 */
function systemPrefersDark(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useTheme(): void {
  const mode = useAppStore((s) => s.settings?.theme ?? 'light');

  // 用 layout effect：改在 layout 阶段之前，避免深色用户开屏闪一帧浅色
  useLayoutEffect(() => {
    const apply = (): void => {
      document.documentElement.dataset.theme = resolveTheme(mode, systemPrefersDark());
    };
    apply();

    // 只有「跟随系统」需要监听：固定模式下这个监听是纯开销
    if (mode !== 'system' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => apply();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);
}
