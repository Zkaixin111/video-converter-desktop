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
import { audioBitrateFor, estimateAudioBytes, isAudioFormat } from '../../shared/audio';
import { CONTAINER_ORDER, isContainerKey, isPresetTier } from '../../shared/containers';
import path from 'node:path';
import { AppError } from '../../shared/errors';
import { resolveTaskParams } from '../../shared/queue';
import { estimateOutputBytes, formatBytes } from '../../shared/estimate';
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
import { toHistoryEntry } from '../../shared/history';
import { batchNotifyText } from '../../shared/notify';
import { checkSpace } from '../core/fs/disk';
import { jobManager } from '../core/job/JobManager';
import { historyStore } from '../history';
import { logger } from '../logger';
import { notifyFinished } from '../notify';
import { queuePersistence } from '../queuePersistence';
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

/** 音频提取（TODO-20）允许源文件没有画面，但必须有音轨 */
function requireMeta(v: unknown, audioOnly = false): MediaMeta {
  const meta = requireObject(v, 'meta') as unknown as MediaMeta;
  requireAbsPath(meta.path, 'meta.path');
  if (audioOnly) {
    if (!meta.audio) {
      throw new AppError('E_NO_AUDIO_STREAM', '这个文件里没有音轨，没法提取音频。');
    }
    return meta;
  }
  if (!meta.video) {
    throw new AppError('E_NO_VIDEO_STREAM', '这个文件里没有视频画面，不能转换成视频格式。', {
      hint: '只想提取声音的话，把输出类型切成「仅音频」。',
    });
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

/**
 * 快照落盘的最小间隔（TODO-12）。
 *
 * 转码中 `onQueue` 每秒会来好几次（进度变动也会推整帧快照）。
 * 两条路都不能走：每次都写会让 SSD 一直被几百字节的 JSON 戳；
 * 纯防抖（debounce）则会因为事件太密而**永远不触发**，等于没做持久化。
 * 所以取「节流出尾随写」—— 第一个变动起 500ms 后落一次，期间的变动合并。
 */
const PERSIST_INTERVAL_MS = 500;

let persistTimer: NodeJS.Timeout | null = null;

/** 队列快照之外的消费方（TODO-14 的系统托盘要跟着队列刷新 tooltip 与菜单） */
const queueListeners: ((snapshot: QueueSnapshot) => void)[] = [];

export function onQueueChanged(fn: (snapshot: QueueSnapshot) => void): void {
  queueListeners.push(fn);
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      queuePersistence().write(jobManager.persistable());
    } catch (err) {
      // 落盘失败不能影响正在跑的任务：它是「增强」，不是链路的一环
      logger.warn('queue snapshot persist failed', String(err));
    }
  }, PERSIST_INTERVAL_MS);
  persistTimer.unref?.();
}

/**
 * 启动时恢复上次没跑完的队列（TODO-12）。
 *
 * 判定「上次是不是崩溃」靠的正是这个文件还在不在：**正常退出会把它删掉**。
 * 所以这里不需要任何退出码或心跳 —— 文件存在 = 上次没走到正常退出。
 *
 * 返回恢复出来的任务数，仅供启动日志使用。
 */
export function restoreQueueSnapshot(): number {
  let n = 0;
  try {
    if (!getSettings().restoreQueue) return 0;
    const items = queuePersistence().read();
    if (items.length === 0) return 0;
    const snapshot = jobManager.restore(items);
    n = snapshot.items.length;
    logger.info('queue restored', `${n} item(s)`);
  } catch (err) {
    // 恢复失败绝不能挡住启动：用户要的是「应用能打开」，队列丢了下次注意就行
    logger.warn('queue restore failed', String(err));
  }
  return n;
}

/** 正常退出时清掉快照：只有崩溃/强杀才应该在下次启动时看到恢复提示 */
export function clearQueueSnapshot(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    queuePersistence().clear();
  } catch (err) {
    logger.warn('queue snapshot clear failed', String(err));
  }
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
    // 精细调节按目标格式读设置；主进程读一次就够了，不需要渲染层再传一遍
    getOverrides: (target: ContainerKey) => {
      const q = getSettings().quality?.[target];
      return q && q.enabled ? q : null;
    },
    getNaming: () => getSettings().naming,
    // 并发数（TODO-10）：设置改了之后新起的任务立刻按新值跑
    getConcurrency: () => getSettings().concurrency,
  });

  jobManager.attach({
    onQueue: (snapshot: QueueSnapshot) => {
      send(EV.queue, snapshot);
      // 托盘（TODO-14）也是队列快照的消费方，但它在 JobManager 之外，故走这个钩子
      for (const fn of queueListeners) {
        try {
          fn(snapshot);
        } catch {
          /* 一个消费方崩了不该影响其余订阅者 */
        }
      }
      schedulePersist();
    },

    // 整批结束才通知（TODO-08）：10 个文件弹 10 条是骚扰，一条汇总才是信息
    onBatchFinished: (summary) => {
      const text = batchNotifyText(summary);
      if (!text) return;
      if (!getSettings().notifyOnFinish) return;
      notifyFinished(getWindow, text);
    },

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

      // 历史是「任务台账」而不是「成功清单」（TODO-07）：
      // 失败恰恰是最需要回看的——它能重跑，且记录了用的什么参数。
      const record = toHistoryEntry(snapshot, Date.now());
      if (record) {
        try {
          historyStore().add(record);
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
        // 音频提取不要求源文件有画面，但必须有音轨
        const audio = isAudioFormat(item.audio) ? item.audio : null;
        const meta = requireMeta(item.meta, audio !== null);
        const resolved = resolve(item.custom, item.globalTarget);
        return {
          meta,
          target: resolved.target,
          preset: resolved.preset,
          custom: resolved.custom,
          audio,
          outputDir: typeof outputDir === 'string' && outputDir ? outputDir : null,
        };
      });

      // 磁盘预检（TODO-03）：批量转换时空间不够是「整批全废」，比单文件失败代价高得多。
      // 这里按最坏情况（全部重编码）估算，宁可多拦一次。
      // 音频按「时长 × 最高档码率」算，同样取最坏情况。
      const required = inputs.reduce(
        (sum, i) =>
          sum +
          (i.audio
            ? estimateAudioBytes(i.meta.durationSec, audioBitrateFor(i.audio, 'high'))
            : estimateOutputBytes({
                sourceSizeBytes: i.meta.sizeBytes,
                mode: 'transcode',
                target: i.target,
                preset: i.preset,
              })),
        0,
      );
      const space = checkSpace(
        (typeof outputDir === 'string' && outputDir ? outputDir : path.dirname(inputs[0].meta.path)) as string,
        required,
      );
      if (!space.enough) {
        throw new AppError(
          'E_DISK_FULL',
          `输出位置空间不足：这 ${inputs.length} 个文件预计需要约 ${formatBytes(required)}，当前可用 ${formatBytes(space.freeBytes ?? 0)}。`,
          { hint: `请至少清理 ${formatBytes(space.shortfallBytes)}，或换一个保存位置。` },
        );
      }

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
