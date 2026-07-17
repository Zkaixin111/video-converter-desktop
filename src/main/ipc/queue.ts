/**
 * queue:* —— 批量队列的入队、编辑、取消、重试、继续。
 *
 * 这里是**唯一**的参数解析点：渲染层只上报「任务自带参数」与「当前全局面板选中的格式」，
 * 由主进程用 shared/queue.ts 的 resolveTaskParams 结合设置里的档位算出最终 target/preset。
 * 放在一处的原因很实际——渲染层算一次、主进程再算一次，两边规则一旦漂移就会出现
 * 「界面显示 WebM，实际写 MP4」这种极难复现的问题。
 */
import { BrowserWindow, ipcMain } from 'electron';
import { CH, EV } from '../../shared/channels';
import { CONTAINER_ORDER, isContainerKey, isPresetTier } from '../../shared/containers';
import { AppError } from '../../shared/errors';
import { resolveTaskParams } from '../../shared/queue';
import type {
  ContainerKey,
  EnqueueItemInput,
  JobSnapshot,
  MediaMeta,
  PresetTier,
  QueueItem,
  QueueSnapshot,
  TaskParams,
} from '../../shared/types';
import { jobManager } from '../core/job/JobManager';
import { historyStore } from '../history';
import { logger } from '../logger';
import { getSettings } from '../store';
import { requireAbsPath, requireArray, requireObject, requireString, wrap } from './wrap';

function requireTarget(v: unknown): ContainerKey {
  requireString(v, 'target');
  if (!isContainerKey(v)) {
    throw new AppError('E_UNSUPPORTED_TARGET', `不支持的目标格式：${String(v)}`, {
      detail: `可选值：${CONTAINER_ORDER.join(', ')}`,
    });
  }
  return v;
}

function requirePreset(v: unknown): PresetTier {
  if (!isPresetTier(v)) {
    throw new AppError('E_BAD_REQUEST', `未知的画质档位：${String(v)}`);
  }
  return v;
}

/** 解析任务自带参数；不存在或字段非法一律当「跟随全局」 */
function parseCustom(v: unknown): TaskParams | null {
  if (v == null) return null;
  try {
    const obj = requireObject(v, 'custom');
    return { target: requireTarget(obj.target), preset: requirePreset(obj.preset) };
  } catch {
    return null;
  }
}

function requireMeta(v: unknown): MediaMeta {
  const meta = requireObject(v, 'meta') as unknown as MediaMeta;
  requireAbsPath(meta.path, 'meta.path');
  if (!meta.video) {
    throw new AppError('E_NO_VIDEO_STREAM', '这个文件里没有视频画面，不能转换成视频格式。');
  }
  return meta;
}

/**
 * 把「任务自带参数 / 全局参数」解析成最终生效值。
 * 优先级：custom > 全局（全局档位按最终 target 取）。
 */
function resolve(
  rawCustom: unknown,
  rawGlobalTarget: unknown,
): { target: ContainerKey; preset: PresetTier; custom: TaskParams | null } {
  const settings = getSettings();
  const custom = parseCustom(rawCustom);
  const globalTarget =
    rawGlobalTarget != null && isContainerKey(rawGlobalTarget)
      ? rawGlobalTarget
      : settings.defaultOutputFormat;
  return resolveTaskParams({ custom, globalTarget, presets: settings.presets });
}

export function registerQueueIpc(getWindow: () => BrowserWindow | null): void {
  // ── 事件转发：窗口可能还没建好，每次发送前判活 ──────────────
  const send = (channel: string, payload: unknown): void => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  jobManager.configure({
    getPolicy: () => getSettings().failurePolicy,
    getMode: () => getSettings().queueMode,
  });

  jobManager.attach({
    onQueue: (snapshot: QueueSnapshot) => send(EV.queue, snapshot),
    onProgress: (payload) => send(EV.progress, payload),
    onState: (snapshot: JobSnapshot) => {
      send(EV.state, snapshot);
      logger.info('job state', snapshot.status, snapshot.jobId ?? '');

      if (snapshot.status === 'error') {
        // 失败必须留痕：用户点「复制诊断信息」时只有末 20 行，这里落全量错误
        logger.warn(
          'job failed',
          snapshot.jobId ?? '',
          snapshot.fileName ?? '',
          snapshot.error?.code ?? '',
          snapshot.error?.message ?? '',
          snapshot.error?.detail ?? '',
        );
      }

      // 只有成功才进历史：失败/取消会在列表里变成噪音
      if (snapshot.status === 'done' && snapshot.result) {
        try {
          historyStore().add({
            id: snapshot.result.jobId,
            fileName: snapshot.fileName ?? '',
            sourcePath: snapshot.sourcePath ?? '',
            outputPath: snapshot.result.outputPath,
            target: snapshot.target ?? 'mp4',
            mode: snapshot.result.mode,
            sourceSizeBytes: snapshot.result.sourceSizeBytes,
            outputSizeBytes: snapshot.result.outputSizeBytes,
            elapsedMs: snapshot.result.elapsedMs,
            verified: snapshot.result.verified,
            finishedAt: Date.now(),
          });
        } catch (err) {
          logger.warn('history append failed', String(err));
        }
      }
    },
  });

  ipcMain.handle(CH.queueEnqueue, (_e, payload: unknown) =>
    wrap<QueueItem[]>(() => {
      const { items, outputDir } = requireObject(payload, 'payload');
      const list = requireArray(items, 'items') as unknown[];

      const inputs = list.map((raw) => {
        const item = requireObject(raw, 'items[]') as unknown as EnqueueItemInput;
        const meta = requireMeta(item.meta);
        const resolved = resolve(item.custom, item.globalTarget);
        return {
          meta,
          target: resolved.target,
          preset: resolved.preset,
          custom: resolved.custom,
          outputDir: typeof outputDir === 'string' && outputDir ? outputDir : null,
        };
      });

      return jobManager.enqueue(inputs).map((r) => r.item);
    }),
  );

  ipcMain.handle(CH.queueList, () => wrap<QueueSnapshot>(() => jobManager.list()));

  ipcMain.handle(CH.queueUpdate, (_e, payload: unknown) =>
    wrap<QueueItem>(() => {
      const { jobId, custom, globalTarget } = requireObject(payload, 'payload');
      // 渲染层总会带上当前面板的格式；缺省时 resolve() 会回落到默认输出格式
      const resolved = resolve(custom, globalTarget);
      return jobManager.updateParams(requireString(jobId, 'jobId'), resolved);
    }),
  );

  ipcMain.handle(CH.queueCancel, (_e, payload: unknown) =>
    wrap<{ ok: boolean }>(async () => {
      const obj = (payload ?? {}) as { jobId?: string };
      const jobId = typeof obj.jobId === 'string' && obj.jobId ? obj.jobId : undefined;
      return { ok: await jobManager.cancel(jobId) };
    }),
  );

  ipcMain.handle(CH.queueRemove, (_e, payload: unknown) =>
    wrap<QueueSnapshot>(() => {
      const { jobId } = requireObject(payload, 'payload');
      return jobManager.remove(requireString(jobId, 'jobId'));
    }),
  );

  ipcMain.handle(CH.queueRetry, (_e, payload: unknown) =>
    wrap<QueueSnapshot>(() => {
      const { jobId } = requireObject(payload, 'payload');
      return jobManager.retry(requireString(jobId, 'jobId'));
    }),
  );

  ipcMain.handle(CH.queueResume, () => wrap<QueueSnapshot>(() => jobManager.resume()));
}
