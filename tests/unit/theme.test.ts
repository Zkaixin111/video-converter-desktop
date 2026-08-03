/**
 * 主题折算（TODO-06）。
 *
 * 断言的是那条最容易写错的规则：「跟随系统」是唯一会把系统偏好算进结果的模式，
 * 一旦固定为 light/dark，系统怎么变都不许跟着动。
 * 另外盯住窗口底色必须与 CSS 的 --bg-app 一致 —— 不一致就会开屏闪白。
 */
import { describe, expect, it } from 'vitest';
import { THEME_MODES, WINDOW_BG, resolveTheme, windowBackgroundOf } from '../../src/shared/theme';

describe('resolveTheme · 固定模式不受系统影响', () => {
  it('固定浅色时，系统哪怕是深色也还是浅色', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('固定深色时，系统哪怕是浅色也还是深色', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
  });
});

describe('resolveTheme · 跟随系统', () => {
  it('系统深色 → 深色，系统浅色 → 浅色', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('resolveTheme · 兜底', () => {
  it('设置里没存过主题时按浅色（与旧版本行为一致）', () => {
    expect(resolveTheme(undefined, true)).toBe('light');
  });

  it('三种模式都在白名单里（设置页据此渲染三个按钮）', () => {
    expect(THEME_MODES).toEqual(['light', 'dark', 'system']);
    for (const m of THEME_MODES) {
      expect(['light', 'dark']).toContain(resolveTheme(m, true));
    }
  });
});

describe('窗口底色', () => {
  it('深色底 = CSS 深色 --bg-app，浅色底 = CSS 浅色 --bg-app', () => {
    expect(WINDOW_BG.light).toBe('#F7F8FA');
    expect(WINDOW_BG.dark).toBe('#0F1115');
  });

  it('windowBackgroundOf 与 resolveTheme 结果一致', () => {
    expect(windowBackgroundOf('dark', false)).toBe(WINDOW_BG.dark);
    expect(windowBackgroundOf('system', true)).toBe(WINDOW_BG.dark);
    expect(windowBackgroundOf('system', false)).toBe(WINDOW_BG.light);
    expect(windowBackgroundOf(undefined, true)).toBe(WINDOW_BG.light);
  });
});
