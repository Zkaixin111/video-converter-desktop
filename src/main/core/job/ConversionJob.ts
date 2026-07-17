/**
 * 单个转换任务的生命周期。
 *
 * 状态机（方案 §2.4）：preparing → running → (done | cancelled | error)
 * 三条硬规则在这里落地：
 *   · rename 成功后才置 done（否则用户看到「完成」但文件夹里没有）
 *   · 校验必须在 rename 之后（否则会「删了文件还说成功」）
 *   · 所有清理放 finally（error / cancel 路径也要删 .part）
 */
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AppError, toAppError } from '../../../shared/errors';
import type {
  ContainerKey,
  JobError,
  JobResult,
  JobSnapshot,
  MediaMeta,
  PlanResult,
  ProgressPayload,
} from '../../../shared/types';
import { runConversion, type RunHandle } from '../ffmpeg/runner';
import { verifyOutput } from '../ffmpeg/verify';
import { cleanupPart, partPathFor } from '../fs/temp';

export interface ConversionJobOptions {
  meta: MediaMeta;
  plan: PlanResult;
  outputPath: string;
  target?: ContainerKey;
  /**
   * 任务 id。队列层会把自己的 jobId 传进来 —— 必须**同一个**：
   * progress / state / result 三个事件都用它，渲染层靠它把事件归到对应卡片。
   * 早先这里各自 randomUUID 会导致「队列拿到的 id」和「进度事件里的 id」不一致，
   * 界面表现为进度条永远不动、终态被当成别人的任务忽略。
   */
  jobId?: string;
  onProgress?: (payload: ProgressPayload) => void;
  onState?: (snapshot: JobSnapshot) => void;
}

export class ConversionJob {
  readonly id: string;
  private readonly meta: MediaMeta;
  private readonly plan: PlanResult;
  private readonly outputPath: string;
  private readonly target?: ContainerKey;
  private readonly onProgress?: (payload: ProgressPayload) => void;
  private readonly onState?: (snapshot: JobSnapshot) => void;

  private status: JobSnapshot['status'] = 'preparing';
  private handle: RunHandle | null = null;
  private startedAt = 0;
  private progress?: ProgressPayload;
  private result?: JobResult;
  private error?: JobError;
  private cancelled = false;

  constructor(options: ConversionJobOptions) {
    this.id = options.jobId ?? randomUUID();
    this.meta = options.meta;
    this.plan = options.plan;
    this.outputPath = options.outputPath;
    this.target = options.target;
    this.onProgress = options.onProgress;
    this.onState = options.onState;
  }

  get outputFile(): string {
    return this.outputPath;
  }

  isRunning(): boolean {
    return this.status === 'preparing' || this.status === 'running';
  }

  snapshot(): JobSnapshot {
    return {
      status: this.status,
      jobId: this.id,
      fileName: this.meta.fileName,
      sourcePath: this.meta.path,
      target: this.target,
      progress: this.progress,
      result: this.result,
      error: this.error,
    };
  }

  private emitState(): void {
    this.onState?.(this.snapshot());
  }

  /** 不 reject：所有失败都转成 error 状态 + 事件，调用方只看快照 */
  async run(): Promise<JobSnapshot> {
    this.startedAt = Date.now();
    const partPath = partPathFor(this.outputPath);
    let renamed = false;

    this.emitState();

    try {
      // 输出目录可能已经不在了（用户手动删过、或者配置里存的是旧路径）。
      // 这里补建一次：mkdir recursive 对已存在的目录是空操作，失败会走下面的错误分支。
      await fs.mkdir(path.dirname(this.outputPath), { recursive: true });

      this.handle = runConversion({
        inputPath: this.meta.path,
        outputPartPath: partPath,
        args: this.plan.args,
        totalDurationSec: this.meta.durationSec,
        onProgress: (sample) => {
          if (this.status === 'preparing') {
            this.status = 'running';
            this.emitState();
          }
          this.progress = {
            jobId: this.id,
            pct: sample.pct,
            speed: sample.speed,
            etaSec: sample.etaSec,
            processedSec: sample.processedSec,
            totalSec: this.meta.durationSec,
          };
          this.onProgress?.(this.progress);
        },
      });

      await this.handle.promise;

      // ① 先落到最终文件名
      await fs.rename(partPath, this.outputPath);
      renamed = true;

      // ② 再校验（顺序不能反）
      const verify = await verifyOutput(this.meta, this.outputPath);
      let outputSize = 0;
      try {
        outputSize = (await fs.stat(this.outputPath)).size;
      } catch {
        /* 交给下面的校验结果处理 */
      }

      if (!verify.ok) {
        // 用户拿到一个坏文件却以为成功了，比直接失败更糟 —— 删掉并报错
        await fs.unlink(this.outputPath).catch(() => {});
        throw new AppError('E_OUTPUT_INVALID', '转换完成但输出文件校验未通过，已删除损坏的文件。', {
          hint: verify.detail ?? '请换一个格式再试一次。',
          detail: verify.detail,
        });
      }

      this.result = {
        jobId: this.id,
        outputPath: this.outputPath,
        outputSizeBytes: outputSize,
        sourceSizeBytes: this.meta.sizeBytes,
        elapsedMs: Date.now() - this.startedAt,
        mode: this.plan.mode,
        verified: true,
        verifyDetail: verify.detail,
      };
      this.status = 'done';
      this.emitState();
      return this.snapshot();
    } catch (err) {
      const appErr = toAppError(err);

      if (this.cancelled || appErr.code === 'E_CANCELLED') {
        this.status = 'cancelled';
        this.error = { code: 'E_CANCELLED', message: '已取消转换。' };
      } else {
        this.status = 'error';
        this.error = {
          code: appErr.code,
          message: appErr.toUserMessage(),
          hint: appErr.hint,
          detail: appErr.detail,
        };
      }
      this.emitState();
      return this.snapshot();
    } finally {
      // rename 之后 part 已经不存在；失败/取消路径必须清干净
      if (!renamed) await cleanupPart(partPath);
      this.handle = null;
    }
  }

  async cancel(): Promise<void> {
    if (!this.isRunning()) return;
    this.cancelled = true;
    await this.handle?.cancel();
  }
}
