/** convert:* —— 规划、启动、取消、状态 */
import { BrowserWindow, ipcMain } from 'electron';
import { CH, EV } from '../../shared/channels';
import { AppError } from '../../shared/errors';
import { CONTAINER_ORDER, isContainerKey } from '../../shared/containers';
import type {
  ContainerKey,
  JobSnapshot,
  MediaMeta,
  PlanResult,
} from '../../shared/types';
import { planConversion } from '../core/ffmpeg/planner';
import { resolveOutputPath } from '../core/fs/outputPath';
import { jobManager } from '../core/job/JobManager';
import { logger } from '../logger';
import { requireObject, requireString, wrap } from './wrap';

function requireTarget(v: unknown): ContainerKey {
  requireString(v, 'target');
  if (!isContainerKey(v)) {
    throw new AppError('E_UNSUPPORTED_TARGET', `不支持的目标格式：${String(v)}`, {
      detail: `可选值：${CONTAINER_ORDER.join(', ')}`,
    });
  }
  return v;
}

function requireMeta(v: unknown): MediaMeta {
  const meta = requireObject(v, 'meta') as unknown as MediaMeta;
  requireString(meta.path, 'meta.path');
  if (!meta.video) {
    throw new AppError('E_NO_VIDEO_STREAM', '这个文件里没有视频画面，不能转换成视频格式。');
  }
  return meta;
}

export function registerConvertIpc(getWindow: () => BrowserWindow | null): void {
  /** 纯计算：渲染层切换格式时高频调用，不能碰磁盘 */
  ipcMain.handle(CH.plan, (_e, payload: unknown) =>
    wrap<PlanResult>(() => {
      const { meta, target } = requireObject(payload, 'payload');
      return planConversion({
        meta: requireMeta(meta),
        target: requireTarget(target),
      });
    }),
  );

  /** 规划 + 输出路径：UI 上「判定条 + 输出位置行」一次拿全 */
  ipcMain.handle(CH.preview, (_e, payload: unknown) =>
    wrap<{ plan: PlanResult; outputPath: string }>(() => {
      const { meta, target, outputDir } = requireObject(payload, 'payload');
      const m = requireMeta(meta);
      const t = requireTarget(target);
      const plan = planConversion({ meta: m, target: t });
      const outputPath = resolveOutputPath(m.path, t, {
        outputDir: typeof outputDir === 'string' && outputDir ? outputDir : null,
      });
      return { plan, outputPath };
    }),
  );

  ipcMain.handle(CH.start, (_e, payload: unknown) =>
    wrap<{ jobId: string; plan: PlanResult; outputPath: string }>(() => {
      const { meta, target, outputDir } = requireObject(payload, 'payload');
      const m = requireMeta(meta);
      const t = requireTarget(target);
      const win = getWindow();

      const started = jobManager.start({
        meta: m,
        target: t,
        outputDir: typeof outputDir === 'string' && outputDir ? outputDir : null,
        onProgress: (progress) => {
          if (win && !win.isDestroyed()) win.webContents.send(EV.progress, progress);
        },
        onState: (snapshot) => {
          if (win && !win.isDestroyed()) win.webContents.send(EV.state, snapshot);
          logger.info('job state', snapshot.status, snapshot.jobId ?? '');
        },
      });

      logger.info('job start', m.fileName, '→', t, 'mode', started.plan.mode);
      return started;
    }),
  );

  ipcMain.handle(CH.cancel, () =>
    wrap<{ ok: boolean }>(async () => ({ ok: await jobManager.cancel() })),
  );

  ipcMain.handle(CH.status, () => wrap<JobSnapshot>(() => jobManager.snapshot()));
}
