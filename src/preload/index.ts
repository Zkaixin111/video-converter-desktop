/**
 * 预加载脚本（在 sandbox 下以 CJS 运行）。
 *
 * 安全基线：**绝不把 ipcRenderer 整个暴露给渲染进程**。
 * 脚手架自带的 `contextBridge.exposeInMainWorld('ipcRenderer', {...})`
 * 等于把任意通道的调用能力交给页面，白名单形同虚设。
 *
 * 这里只暴露具名函数：渲染层能做什么，完全由下面这个对象决定。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CH, EV } from '../shared/channels';
import type {
  AudioFormat,
  AudioPlanResult,
  Capabilities,
  ContainerKey,
  DiskEstimate,
  EnqueueItemInput,
  HistoryItem,
  IpcResult,
  JobSnapshot,
  MediaMeta,
  PlanResult,
  PresetTier,
  ProgressPayload,
  QueueItem,
  QueueSnapshot,
  Settings,
  TaskParams,
} from '../shared/types';

/** 事件订阅统一返回取消函数，避免渲染层反复挂载后重复触发 */
function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => handler(payload);
  ipcRenderer.on(channel, listener as never);
  return () => {
    ipcRenderer.removeListener(channel, listener as never);
  };
}

const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  /* ── 媒体 ─────────────────────────────────────────────── */
  probe: (path: string): Promise<IpcResult<MediaMeta>> => ipcRenderer.invoke(CH.probe, { path }),

  thumbnail: (path: string, atSec?: number): Promise<IpcResult<{ dataUrl: string | null }>> =>
    ipcRenderer.invoke(CH.thumbnail, { path, atSec }),

  /* ── 转换 ─────────────────────────────────────────────── */
  plan: (
    meta: MediaMeta,
    target: ContainerKey,
    preset?: PresetTier,
  ): Promise<IpcResult<PlanResult>> => ipcRenderer.invoke(CH.plan, { meta, target, preset }),

  /**
   * 规划 + 输出路径。
   * `audio` 非空时返回 `audioPlan`（音频提取，TODO-20），否则返回 `plan`；两者互斥。
   */
  preview: (
    meta: MediaMeta,
    target: ContainerKey,
    outputDir?: string | null,
    preset?: PresetTier,
    audio?: AudioFormat | null,
  ): Promise<
    IpcResult<{
      plan: PlanResult | null;
      audioPlan: AudioPlanResult | null;
      outputPath: string;
      disk: DiskEstimate;
    }>
  > => ipcRenderer.invoke(CH.preview, { meta, target, outputDir, preset, audio }),

  start: (
    meta: MediaMeta,
    target: ContainerKey,
    outputDir?: string | null,
    preset?: PresetTier,
  ): Promise<IpcResult<{ jobId: string; plan: PlanResult; outputPath: string }>> =>
    ipcRenderer.invoke(CH.start, { meta, target, outputDir, preset }),

  cancel: (): Promise<IpcResult<{ ok: boolean }>> => ipcRenderer.invoke(CH.cancel),

  status: (): Promise<IpcResult<JobSnapshot>> => ipcRenderer.invoke(CH.status),

  /* ── 队列 ─────────────────────────────────────────────── */
  enqueue: (
    items: EnqueueItemInput[],
    outputDir?: string | null,
  ): Promise<IpcResult<QueueItem[]>> =>
    ipcRenderer.invoke(CH.queueEnqueue, { items, outputDir }),

  listQueue: (): Promise<IpcResult<QueueSnapshot>> => ipcRenderer.invoke(CH.queueList),

  updateQueueItem: (
    jobId: string,
    custom: TaskParams | null,
    globalTarget: ContainerKey,
  ): Promise<IpcResult<QueueItem>> =>
    ipcRenderer.invoke(CH.queueUpdate, { jobId, custom, globalTarget }),

  cancelQueueItem: (jobId?: string): Promise<IpcResult<{ ok: boolean }>> =>
    ipcRenderer.invoke(CH.queueCancel, { jobId }),

  removeQueueItem: (jobId: string): Promise<IpcResult<QueueSnapshot>> =>
    ipcRenderer.invoke(CH.queueRemove, { jobId }),

  retryQueueItem: (jobId: string): Promise<IpcResult<QueueSnapshot>> =>
    ipcRenderer.invoke(CH.queueRetry, { jobId }),

  resumeQueue: (): Promise<IpcResult<QueueSnapshot>> => ipcRenderer.invoke(CH.queueResume),

  /** 主动暂停队列（TODO-13）：正在跑的那个会跑完，剩下的不启动 */
  pauseQueue: (): Promise<IpcResult<QueueSnapshot>> => ipcRenderer.invoke(CH.queuePause),

  /** 调整位次（TODO-13）：负数上移、正数下移，单位是「等待序列里的几位」 */
  reorderQueueItem: (jobId: string, delta: number): Promise<IpcResult<QueueSnapshot>> =>
    ipcRenderer.invoke(CH.queueReorder, { jobId, delta }),

  onProgress: (cb: (p: ProgressPayload) => void) => subscribe<ProgressPayload>(EV.progress, cb),
  onState: (cb: (s: JobSnapshot) => void) => subscribe<JobSnapshot>(EV.state, cb),
  onQueue: (cb: (s: QueueSnapshot) => void) => subscribe<QueueSnapshot>(EV.queue, cb),

  /* ── 历史 ─────────────────────────────────────────────── */
  listHistory: (): Promise<IpcResult<HistoryItem[]>> => ipcRenderer.invoke(CH.historyList),

  removeHistory: (id: string): Promise<IpcResult<HistoryItem[]>> =>
    ipcRenderer.invoke(CH.historyRemove, { id }),

  clearHistory: (): Promise<IpcResult<{ ok: boolean }>> => ipcRenderer.invoke(CH.historyClear),

  /** 一键重跑：按记录里的原参数重新入队（TODO-07） */
  rerunHistory: (id: string): Promise<IpcResult<QueueItem[]>> =>
    ipcRenderer.invoke(CH.historyRerun, { id }),

  /* ── 系统 ─────────────────────────────────────────────── */
  openFolder: (path: string, mkdir = false): Promise<IpcResult<{ ok: boolean }>> =>
    ipcRenderer.invoke(CH.openFolder, { path, mkdir }),

  selectOutputDir: (): Promise<IpcResult<{ path: string | null }>> =>
    ipcRenderer.invoke(CH.selectOutputDir),

  selectVideo: (multi = false): Promise<IpcResult<{ path: string | null; paths: string[] }>> =>
    ipcRenderer.invoke(CH.selectVideo, { multi }),

  openExternal: (url: string): Promise<IpcResult<{ ok: boolean }>> =>
    ipcRenderer.invoke(CH.openExternal, { url }),

  /* ── 应用 ─────────────────────────────────────────────── */
  capabilities: (recheck = false): Promise<IpcResult<Capabilities>> =>
    ipcRenderer.invoke(CH.capabilities, { recheck }),

  getSettings: (): Promise<IpcResult<Settings>> => ipcRenderer.invoke(CH.getSettings),

  setSettings: (patch: Partial<Settings>): Promise<IpcResult<Settings>> =>
    ipcRenderer.invoke(CH.setSettings, { patch }),

  copyText: (text: string): Promise<IpcResult<{ ok: boolean }>> =>
    ipcRenderer.invoke(CH.copyText, { text }),

  windowControl: (action: 'minimize' | 'maximize' | 'close'): Promise<IpcResult<{ ok: boolean }>> =>
    ipcRenderer.invoke(CH.windowControl, { action }),

  /* ── 日志与诊断（TODO-11） ─────────────────────────────── */
  openLogs: (): Promise<IpcResult<{ ok: boolean }>> => ipcRenderer.invoke(CH.openLogs),

  jobLog: (jobId: string): Promise<IpcResult<{ lines: string[] }>> =>
    ipcRenderer.invoke(CH.jobLog, { jobId }),

  exportDiagnostics: (): Promise<IpcResult<{ path: string | null }>> =>
    ipcRenderer.invoke(CH.exportDiagnostics),

  /**
   * 拖拽落地文件的真实路径。
   * Electron 32+ 移除了 File.path，必须走 webUtils（且必须在 preload 里调）。
   */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
} as const;

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
