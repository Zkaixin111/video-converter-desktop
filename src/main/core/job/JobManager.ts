/**
 * 任务调度：MVP 同一时刻只允许一个任务（批量队列见 docs/BACKLOG.md P1-01）。
 *
 * 五条硬规则（方案 §3.7）：
 *   1. 单任务 —— 并发会引入资源竞争，8 容器全支持已经很重
 *   2. start 前必须检查 isRunning()，防用户连点两次起两个 ffmpeg
 *   3. 所有清理在 finally
 *   4. rename 成功后才置 done
 *   5. 退出前 before-quit 里 kill 当前任务，否则关窗后 ffmpeg 还在后台跑
 */
import { AppError } from '../../../shared/errors';
import type {
  ContainerKey,
  JobSnapshot,
  MediaMeta,
  PlanResult,
  PresetTier,
  ProgressPayload,
} from '../../../shared/types';
import { planConversion } from '../ffmpeg/planner';
import { resolveOutputPath } from '../fs/outputPath';
import { ConversionJob } from './ConversionJob';

export interface StartOptions {
  meta: MediaMeta;
  target: ContainerKey;
  /** 画质档位，来自参数预设页；缺省 standard */
  preset?: PresetTier;
  outputDir?: string | null;
  onProgress?: (payload: ProgressPayload) => void;
  onState?: (snapshot: JobSnapshot) => void;
}

export interface StartResult {
  jobId: string;
  plan: PlanResult;
  outputPath: string;
}

export class JobManager {
  private current: ConversionJob | null = null;
  private lastSnapshot: JobSnapshot = { status: 'idle' };

  isBusy(): boolean {
    return this.current?.isRunning() ?? false;
  }

  /** 立即返回 jobId，进度与终态通过事件推送（不让 invoke 挂上几分钟） */
  start(options: StartOptions): StartResult {
    if (this.isBusy()) {
      throw new AppError('E_BUSY', '已有任务在进行中，请等它结束或先取消。');
    }

    const plan = planConversion({
      meta: options.meta,
      target: options.target,
      options: { preset: options.preset },
    });
    const outputPath = resolveOutputPath(options.meta.path, options.target, {
      outputDir: options.outputDir ?? null,
    });

    const job = new ConversionJob({
      meta: options.meta,
      plan,
      outputPath,
      target: options.target,
      onProgress: (payload) => {
        this.lastSnapshot = { ...this.lastSnapshot, progress: payload };
        options.onProgress?.(payload);
      },
      onState: (snapshot) => {
        this.lastSnapshot = snapshot;
        if (snapshot.status === 'done' || snapshot.status === 'error' || snapshot.status === 'cancelled') {
          // 终态之后保留快照供 convert:status 查询，但释放 current 让下一次 start 可用
          this.current = null;
        }
        options.onState?.(snapshot);
      },
    });

    this.current = job;
    this.lastSnapshot = job.snapshot();

    // 故意不 await：转码可能几分钟，invoke 立刻返回 jobId
    void job.run();
    return { jobId: job.id, plan, outputPath };
  }

  async cancel(): Promise<boolean> {
    if (!this.current) return false;
    await this.current.cancel();
    return true;
  }

  snapshot(): JobSnapshot {
    return this.current?.snapshot() ?? this.lastSnapshot;
  }

  /** 应用退出前调用，避免 ffmpeg 变成孤儿进程 */
  async dispose(): Promise<void> {
    await this.current?.cancel();
  }
}

export const jobManager = new JobManager();
