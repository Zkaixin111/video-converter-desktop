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
  /** 打开日志所在目录（TODO-11） */
  openLogs: 'app:openLogs',
  /** 取某个任务的日志片段（TODO-11） */
  jobLog: 'app:jobLog',
  /** 导出诊断包（TODO-11） */
  exportDiagnostics: 'app:exportDiagnostics',

  historyList: 'history:list',
  historyRemove: 'history:remove',
  historyClear: 'history:clear',
  /** 按历史条目重跑（TODO-07） */
  historyRerun: 'history:rerun',

  /** 批量队列 */
  queueEnqueue: 'queue:enqueue',
  queueList: 'queue:list',
  queueUpdate: 'queue:update',
  queueCancel: 'queue:cancel',
  queueRemove: 'queue:remove',
  queueRetry: 'queue:retry',
  queueResume: 'queue:resume',
  /** 主动暂停队列（TODO-13）：与「失败即暂停」共用恢复入口 */
  queuePause: 'queue:pause',
  /** 调整等待中任务的位次（TODO-13） */
  queueReorder: 'queue:reorder',
} as const;

/** 推送型事件 */
export const EV = {
  progress: 'convert:progress',
  state: 'convert:state',
  /** 队列结构变化（入队 / 状态流转 / 暂停恢复），渲染层整体替换 */
  queue: 'queue:changed',
} as const;

export type WindowAction = 'minimize' | 'maximize' | 'close';
