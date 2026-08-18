/** convert:* —— 规划、启动（单任务入队）、取消、状态 */
import { ipcMain } from 'electron';
import { CH } from '../../shared/channels';
import { AppError } from '../../shared/errors';
import { estimateOutputBytes } from '../../shared/estimate';
import path from 'node:path';
import { CONTAINER_ORDER, isContainerKey, isPresetTier } from '../../shared/containers';
import { isAudioFormat } from '../../shared/audio';
import type {
  AudioPlanResult,
  ContainerKey,
  JobSnapshot,
  DiskEstimate,
  MediaMeta,
  PlanResult,
  PresetTier,
  QualityOverrides,
} from '../../shared/types';
import { planAudioExtraction, planConversion } from '../core/ffmpeg/planner';
import { checkSpace } from '../core/fs/disk';
import { resolveAudioPath, resolveOutputPath } from '../core/fs/outputPath';
import { jobManager } from '../core/job/JobManager';
import { logger } from '../logger';
import { getSettings } from '../store';
import { requireAbsPath, requireObject, requireString, wrap } from './wrap';

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

/**
 * 精细调节参数按目标格式从设置里取。
 * 不让它走 IPC 参数：同一份设置主进程自己能读到，
 * 再多一条传参路径就多一处「界面显示的和实际用的不一致」。
 */
function overridesFor(target: ContainerKey): QualityOverrides | null {
  const q = getSettings().quality?.[target];
  return q && q.enabled ? q : null;
}

/**
 * 校验媒体信息，返回「缺不缺要用的那条流」。
 *
 * 音频提取（TODO-20）与视频转换的**必填项正好相反**：
 * 视频要画面、音频要声音。所以这里按模式分流，而不是统一要求「两者都有」——
 * 否则纯音频文件（比如 .m4a 源）连提取音频都做不了。
 */
function checkMeta(v: unknown, audioOnly = false): { meta: MediaMeta; ready: boolean } {
  const meta = requireObject(v, 'meta') as unknown as MediaMeta;
  requireAbsPath(meta.path, 'meta.path');
  return { meta, ready: audioOnly ? Boolean(meta.audio) : Boolean(meta.video) };
}

/** 严格版：缺流直接报错，用于真正要开始执行的入口 */
function requireMeta(v: unknown, audioOnly = false): MediaMeta {
  const { meta, ready } = checkMeta(v, audioOnly);
  if (!ready) {
    if (audioOnly) {
      throw new AppError('E_NO_AUDIO_STREAM', '这个文件里没有音轨，没法提取音频。');
    }
    throw new AppError('E_NO_VIDEO_STREAM', '这个文件里没有视频画面，不能转换成视频格式。', {
      hint: '只想提取声音的话，把输出类型切成「仅音频」。',
    });
  }
  return meta;
}

export function registerConvertIpc(): void {
  /** 纯计算：渲染层切换格式时高频调用，不能碰磁盘 */
  ipcMain.handle(CH.plan, (_e, payload: unknown) =>
    wrap<PlanResult>(() => {
      const { meta, target, preset } = requireObject(payload, 'payload');
      const m = requireMeta(meta);
      const t = requireTarget(target);
      return planConversion({
        meta: m,
        target: t,
        options: { preset: resolvePreset(preset, t), overrides: overridesFor(t) },
      });
    }),
  );

  /**
   * 规划 + 输出路径：UI 上「判定条 + 输出位置行」一次拿全。
   *
   * `audio` 非空时走音频提取（TODO-20）：返回 `audioPlan` 而不是 `plan`，
   * 两者互斥 —— 同一个任务不可能既输出视频又只输出声音。
   */
  ipcMain.handle(CH.preview, (_e, payload: unknown) =>
    wrap<{
      plan: PlanResult | null;
      audioPlan: AudioPlanResult | null;
      outputPath: string;
      disk: DiskEstimate;
    }>(() => {
      const { meta, target, outputDir, preset, audio } = requireObject(payload, 'payload');
      const wantAudio = isAudioFormat(audio);
      // 音频预览阶段「缺流」不算失败：没有音轨的文件照样要能进批次，
      // 判定条会说明原因，用户把输出类型切回「视频转换」就能接着用同一个文件。
      // 若在这里抛错，文件根本进不了批次，用户连改回来的机会都没有。
      // 视频路径维持原样（缺画面直接报错），行为与 TODO-20 之前逐字一致。
      const m = wantAudio ? checkMeta(meta, true).meta : requireMeta(meta);
      const ready = wantAudio ? Boolean(m.audio) : true;
      const outDir = typeof outputDir === 'string' && outputDir ? outputDir : null;
      const naming = getSettings().naming;
      // 预览永远用 rename：这里只是「会写到哪」，
      // 真正执行时才按 skip 策略决定要不要跳过。
      const pathOptions = { outputDir: outDir, template: naming.template, conflict: 'rename' } as const;

      if (wantAudio) {
        const p = resolvePreset(preset, 'mp4');
        const audioPlan = ready ? planAudioExtraction({ meta: m, format: audio, preset: p }) : null;
        const outputPath = resolveAudioPath(m.path, audio, { ...pathOptions, preset: p });
        return {
          plan: null,
          audioPlan,
          outputPath,
          disk: checkSpace(outDir ?? path.dirname(m.path), audioPlan?.estimateBytes ?? 0),
        };
      }

      const t = requireTarget(target);
      const plan = planConversion({
        meta: m,
        target: t,
        options: { preset: resolvePreset(preset, t), overrides: overridesFor(t) },
      });
      const outputPath = resolveOutputPath(m.path, t, { ...pathOptions, preset: plan.preset });
      const disk = checkSpace(
        outDir ?? path.dirname(m.path),
        estimateOutputBytes({
          sourceSizeBytes: m.sizeBytes,
          mode: plan.mode,
          target: t,
          preset: plan.preset,
        }),
      );
      return { plan, audioPlan: null, outputPath, disk };
    }),
  );

  /**
   * 兼容入口：单任务入队。
   *
   * 批量走 queue:enqueue；这里保留是因为「转换页点开始」在语义上就是一次入队，
   * 让渲染层复用同一条路径（少一条链路，就少一处状态不一致的机会）。
   */
  ipcMain.handle(CH.start, (_e, payload: unknown) =>
    wrap<{ jobId: string; plan: PlanResult; outputPath: string }>(() => {
      const { meta, target, outputDir, preset } = requireObject(payload, 'payload');
      const m = requireMeta(meta);
      const t = requireTarget(target);
      const p = resolvePreset(preset, t);

      const [first] = jobManager.enqueue([
        { meta: m, target: t, preset: p, custom: null, outputDir: typeof outputDir === 'string' && outputDir ? outputDir : null },
      ]);
      // 这个入口只做视频（音频提取走 queue:enqueue），拿不到 plan 就是入队失败
      if (!first || !first.plan) throw new AppError('E_UNKNOWN', '入队失败，请重试。');

      logger.info('job enqueue', m.fileName, '→', t, 'mode', first.plan.mode);
      return { jobId: first.item.jobId, plan: first.plan, outputPath: first.item.outputPath };
    }),
  );

  ipcMain.handle(CH.cancel, () =>
    wrap<{ ok: boolean }>(async () => ({ ok: await jobManager.cancel() })),
  );

  ipcMain.handle(CH.status, () => wrap<JobSnapshot>(() => jobManager.snapshot()));
}
