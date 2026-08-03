/**
 * 主题（TODO-06）—— 只为「三选一 + 系统偏好 → 最终主题」这一件事服务。
 *
 * 放在 shared 而不是 renderer：主进程创建窗口时要先知道底色（否则深色用户开屏闪白），
 * 渲染进程也要算同一个结果。两边各写一遍迟早会漂，所以收敛成一个纯函数。
 *
 * 注意本文件不 import electron —— 它是纯函数，可以直接单测。
 */
import type { ThemeMode } from './types';

export type ResolvedTheme = 'light' | 'dark';

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

/** 三选一 + 系统偏好 → 最终主题。mode 为 light/dark 时系统偏好不参与 */
export function resolveTheme(mode: ThemeMode | undefined, systemDark: boolean): ResolvedTheme {
  const m: ThemeMode = mode ?? 'light';
  if (m === 'system') return systemDark ? 'dark' : 'light';
  return m;
}

/** 窗口底色。与 CSS 里的 --bg-app 必须一致，改一处要改两处 */
export const WINDOW_BG: Record<ResolvedTheme, string> = {
  light: '#F7F8FA',
  dark: '#0F1115',
};

export function windowBackgroundOf(mode: ThemeMode | undefined, systemDark: boolean): string {
  return WINDOW_BG[resolveTheme(mode, systemDark)];
}
