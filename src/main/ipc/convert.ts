/** convert:* —— 规划、启动、取消、状态 */
import { BrowserWindow, ipcMain } from 'electron';
import { CH, EV } from '../../shared/channels';
import { AppError } from '../../shared/errors';
import { CONTAINER_ORDER, isContainerKey, isPresetTier } from '../../shared/containers';
import type {
  ContainerKey,
  JobSnapshot,
  MediaMeta,
  PlanResult,
  PresetTier,
} from '../../shared/types';
import { planConversion } from '../core/ffmpeg/planner';
import { resolveOutputPath } from '../core/fs/outputPath';
import { jobManager } from '../core/job/JobManager';
import { historyStore } from '../history';
import { logger } from '../logger';
import { getSettings } from '../store';
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

/**
 * 画质档位：渲染层传了就按它，没传（或传了非法值）回落到该容器在设置里的档位。
 * 回落而不是报错——档位是「偏好」，不该让整次转换因为一个脏字段失败。
 */
function resolvePreset(v: unknown, target: ContainerKey): PresetTier {
  if (isPresetTier(v)) return v;
  return getSettings().presets[target];
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
      const { meta, target, preset } = requireObject(payload, 'payload');
      const m = requireMeta(meta);
      const t = requireTarget(target);
      return planConversion({ meta: m, target: t, options: { preset: resolvePreset(preset, t) } });
    }),
  );

  /** 规划 + 输出路径：UI 上「判定条 + 输出位置行」一次拿全 */
  ipcMain.handle(CH.preview, (_e, payload: unknown) =>
    wrap<{ plan: PlanResult; outputPath: string }>(() => {
      const { meta, target, outputDir, preset } = requireObject(payload, 'payload');
      const m = requireMeta(meta);
      const t = requireTarget(target);
      const plan = planConversion({
        meta: m,
        target: t,
        options: { preset: resolvePreset(preset, t) },
      });
      const outputPath = resolveOutputPath(m.path, t, {
        outputDir: typeof outputDir === 'string' && outputDir ? outputDir : null,
      });
      return { plan, outputPath };
    }),
  );

  ipcMain.handle(CH.start, (_e, payload: unknown) =>
    wrap<{ jobId: string; plan: PlanResult; outputPath: string }>(() => {
      const { meta, target, outputDir, preset } = requireObject(payload, 'payload');
      const m = requireMeta(meta);
      const t = requireTarget(target);
      const win = getWindow();

      const started = jobManager.start({
        meta: m,
        target: t,
        preset: resolvePreset(preset, t),
        outputDir: typeof outputDir === 'string' && outputDir ? outputDir : null,
        onProgress: (progress) => {
          if (win && !win.isDestroyed()) win.webContents.send(EV.progress, progress);
        },
        onState: (snapshot) => {
          if (win && !win.isDestroyed()) win.webContents.send(EV.state, snapshot);
          logger.info('job state', snapshot.status, snapshot.jobId ?? '');
          // 只有成功才进历史：失败/取消会在列表里变成噪音
          if (snapshot.status === 'done' && snapshot.result) {
            try {
              historyStore().add({
                id: snapshot.result.jobId,
                fileName: m.fileName,
                sourcePath: m.path,
                outputPath: snapshot.result.outputPath,
                target: t,
                mode: snapshot.result.mode,
                sourceSizeBytes: snapshot.result.sourceSizeBytes,
                outputSizeBytes: snapshot.result.outputSizeBytes,
                elapsedMs: snapshot.result.elapsedMs,
                verified: snapshot.result.verified,
                finishedAt: Date.now(),
              });
            } catch (err) {
              // 历史写失败不能影响转换结果，只留日志
              logger.warn('history append failed', String(err));
            }
          }
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
