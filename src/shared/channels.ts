/**
 * IPC 通道名常量。
 *
 * 集中在这里的原因：主进程、preload 都要用同一份字符串，
 * 散落在各处迟早会出现「改了主进程忘了 preload」的静默失效。
 */

export const CH = {
  probe: 'media:probe',
  thumbnail: 'media:thumbnail',

  plan: 'convert:plan',
  preview: 'convert:preview',
  start: 'convert:start',
  cancel: 'convert:cancel',
  status: 'convert:status',

  openFolder: 'shell:openFolder',
  selectOutputDir: 'dialog:selectOutputDir',
  selectVideo: 'dialog:selectVideo',
  openExternal: 'shell:openExternal',

  capabilities: 'app:capabilities',
  getSettings: 'app:getSettings',
  setSettings: 'app:setSettings',
  copyText: 'app:copyText',
  windowControl: 'window:control',
} as const;

/** 推送型事件 */
export const EV = {
  progress: 'convert:progress',
  state: 'convert:state',
} as const;

export type WindowAction = 'minimize' | 'maximize' | 'close';
