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
  Capabilities,
  ContainerKey,
  IpcResult,
  JobSnapshot,
  MediaMeta,
  PlanResult,
  ProgressPayload,
  Settings,
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
  plan: (meta: MediaMeta, target: ContainerKey): Promise<IpcResult<PlanResult>> =>
    ipcRenderer.invoke(CH.plan, { meta, target }),

  preview: (
    meta: MediaMeta,
    target: ContainerKey,
    outputDir?: string | null,
  ): Promise<IpcResult<{ plan: PlanResult; outputPath: string }>> =>
    ipcRenderer.invoke(CH.preview, { meta, target, outputDir }),

  start: (
    meta: MediaMeta,
    target: ContainerKey,
    outputDir?: string | null,
  ): Promise<IpcResult<{ jobId: string; plan: PlanResult; outputPath: string }>> =>
    ipcRenderer.invoke(CH.start, { meta, target, outputDir }),

  cancel: (): Promise<IpcResult<{ ok: boolean }>> => ipcRenderer.invoke(CH.cancel),

  status: (): Promise<IpcResult<JobSnapshot>> => ipcRenderer.invoke(CH.status),

  onProgress: (cb: (p: ProgressPayload) => void) => subscribe<ProgressPayload>(EV.progress, cb),
  onState: (cb: (s: JobSnapshot) => void) => subscribe<JobSnapshot>(EV.state, cb),

  /* ── 系统 ─────────────────────────────────────────────── */
  openFolder: (path: string): Promise<IpcResult<{ ok: boolean }>> =>
    ipcRenderer.invoke(CH.openFolder, { path }),

  selectOutputDir: (): Promise<IpcResult<{ path: string | null }>> =>
    ipcRenderer.invoke(CH.selectOutputDir),

  selectVideo: (): Promise<IpcResult<{ path: string | null }>> => ipcRenderer.invoke(CH.selectVideo),

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
