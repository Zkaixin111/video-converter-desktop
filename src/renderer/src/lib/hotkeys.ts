/**
 * 全局快捷键清单（TODO-09）。
 *
 * 单独放一个文件是为了让「实际生效的按键」与「设置页贴出来的清单」
 * 读同一份数据 —— 两边各写一遍，改了键位忘了改文档是迟早的事。
 *
 * 不做自定义键位：这是一个自用工具，键位是约定，
 * 让用户去改它只会带来「我改了什么来着」的成本。
 */
export interface HotkeySpec {
  /** 展示用的按键串（Ctrl 在 macOS 上显示为 Cmd） */
  keys: string;
  action: string;
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

const MOD = IS_MAC ? 'Cmd' : 'Ctrl';

export const HOTKEYS: HotkeySpec[] = [
  { keys: `${MOD}+O`, action: '添加视频文件' },
  { keys: `${MOD}+Enter`, action: '开始转换' },
  { keys: 'Esc', action: '取消当前转换' },
  { keys: `${MOD}+Shift+Q`, action: '打开任务队列' },
];
