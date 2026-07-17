/**
 * 任务调度：单并发 FIFO 队列。
 *
 * 从 MVP 的「单任务」升级到队列，核心只有一句话：
 * **同一时刻仍然只跑一个 ffmpeg**（并发会抢 CPU、让进度失去意义、让失败归因变难），
 * 但排队、编辑、重试、失败暂停这些都属于队列层的事。
 *
 * 六条硬规则：
 *   1. 单并发：`activeId` 非空时绝不再 pump
 *   2. 输出路径在**入队时**就预定（`reserved` 集合），否则两个同名任务会算出同一个路径
 *   3. 完成/取消的任务立刻移出队列（结果进历史），失败的任务留在队列里标红等人处理
 *   4. 「失败即暂停」在**失败那一刻**读取设置，用户中途改设置也能生效
 *   5. 重试 = 重新规划 + 重新预定路径 + 状态回 pending，jobId 不变（日志与历史能对上）
 *   6. 所有终态都要释放预定、清空 activeId，然后 pump 下一个
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../shared/errors';
import { canEditTask, canRemoveTask, canRetryTask } from '../../../shared/queue';
import type {
  ContainerKey,
  FailurePolicy,
  JobSnapshot,
  MediaMeta,
  PlanResult,
  PresetTier,
  ProgressPayload,
  QueueItem,
  QueueMode,
  QueueSnapshot,
  TaskParams,
} from '../../../shared/types';
import { planConversion } from '../ffmpeg/planner';
import { resolveOutputPath } from '../fs/outputPath';
import { ConversionJob } from './ConversionJob';

export interface EnqueueInput {
  meta: MediaMeta;
  /** 已解析好的目标格式（custom 优先） */
  target: ContainerKey;
  /** 已解析好的档位（custom 优先） */
  preset: PresetTier;
  /** 非空 = 任务自带参数 */
  custom: TaskParams | null;
  outputDir?: string | null;
}

export interface EnqueuedJob {
  item: QueueItem;
  plan: PlanResult;
}

/** 外部依赖全部可注入，方便集成测试构造不同策略 */
export interface JobManagerDeps {
  /** 失败策略：每次失败时读取，不缓存 */
  getPolicy?: () => FailurePolicy;
  /** 队列模式：仅用于快照展示，不参与调度 */
  getMode?: () => QueueMode;
  exists?: (p: string) => boolean;
}

export interface JobManagerSink {
  onQueue?: (snapshot: QueueSnapshot) => void;
  onProgress?: (payload: ProgressPayload) => void;
  onState?: (snapshot: JobSnapshot) => void;
}

interface Entry {
  jobId: string;
  meta: MediaMeta;
  target: ContainerKey;
  preset: PresetTier;
  custom: TaskParams | null;
  outputDir: string | null;
  outputPath: string;
  plan: PlanResult;
  status: QueueItem['status'];
  progress?: ProgressPayload;
  result?: QueueItem['result'];
  error?: QueueItem['error'];
  createdAt: number;
  job: ConversionJob | null;
}

/** Windows 路径大小写不敏感，预定表统一小写比较 */
function norm(p: string): string {
  return p.toLowerCase();
}

export class JobManager {
  private entries: Entry[] = [];
  private activeId: string | null = null;
  private paused = false;
  private pausedReason: 'failure' | null = null;
  private reserved = new Set<string>();
  private sink: JobManagerSink = {};
  private lastSnapshot: JobSnapshot = { status: 'idle' };

  constructor(private deps: JobManagerDeps = {}) {}

  /**
   * 运行期注入依赖。
   *
   * 单例在模块加载时就创建了，那时 electron 的 app 还没 ready，
   * 所以策略/模式只能在 IPC 注册阶段接进来。
   */
  configure(deps: JobManagerDeps): void {
    this.deps = { ...this.deps, ...deps };
  }

  /** 事件接收方（主进程窗口转发）。只装配一次，重复调用后者覆盖 */
  attach(sink: JobManagerSink): void {
    this.sink = sink;
  }

  private policy(): FailurePolicy {
    return this.deps.getPolicy?.() ?? 'continue';
  }

  private exists(p: string): boolean {
    if (this.reserved.has(norm(p))) return true;
    return (this.deps.exists ?? fs.existsSync)(p);
  }

  isBusy(): boolean {
    return this.activeId !== null;
  }

  /**
   * 批量入队。规划与路径预定都在这里完成 ——
   * 入队即返回真实输出路径，用户不必等排到自己才知道文件会写到哪里。
   */
  enqueue(inputs: EnqueueInput[]): EnqueuedJob[] {
    if (inputs.length === 0) return [];

    const out: EnqueuedJob[] = [];
    for (const input of inputs) {
      const plan = planConversion({
        meta: input.meta,
        target: input.target,
        options: { preset: input.preset },
      });
      const outputPath = resolveOutputPath(input.meta.path, input.target, {
        outputDir: input.outputDir ?? null,
        exists: (p) => this.exists(p),
      });
      this.reserved.add(norm(outputPath));

      const entry: Entry = {
        jobId: randomUUID(),
        meta: input.meta,
        target: input.target,
        preset: input.preset,
        custom: input.custom,
        outputDir: input.outputDir ?? null,
        outputPath,
        plan,
        status: 'pending',
        createdAt: Date.now(),
        job: null,
      };
      this.entries.push(entry);
      out.push({ item: toItem(entry), plan });
    }

    this.emitQueue();
    this.pump();
    return out;
  }

  list(): QueueSnapshot {
    return {
      items: this.entries.map(toItem),
      activeId: this.activeId,
      paused: this.paused,
      pausedReason: this.pausedReason,
      mode: this.deps.getMode?.() ?? 'shared',
      policy: this.policy(),
    };
  }

  /** 兼容旧接口：当前任务的快照 */
  snapshot(): JobSnapshot {
    const active = this.activeId ? this.find(this.activeId) : null;
    return active ? activeJobSnapshot(active) : this.lastSnapshot;
  }

  find(jobId: string): Entry | null {
    return this.entries.find((e) => e.jobId === jobId) ?? null;
  }

  /**
   * 修改任务参数（仅限还没跑或已失败的）。
   *
   * 参数变更会连带重算输出路径：目标格式变了扩展名也变了，
   * 沿用旧路径会写出一个「叫 .webm 但内容是 mp4」的文件。
   */
  updateParams(
    jobId: string,
    next: { target: ContainerKey; preset: PresetTier; custom: TaskParams | null },
  ): QueueItem {
    const entry = this.mustFind(jobId);
    if (!canEditTask(entry.status)) {
      throw new AppError('E_BAD_REQUEST', '这个任务已经开始处理，不能再改参数。', {
        hint: '等它结束，或先取消再改。',
      });
    }

    this.reserved.delete(norm(entry.outputPath));
    const plan = planConversion({
      meta: entry.meta,
      target: next.target,
      options: { preset: next.preset },
    });
    const outputPath = resolveOutputPath(entry.meta.path, next.target, {
      outputDir: entry.outputDir,
      exists: (p) => this.exists(p),
    });
    this.reserved.add(norm(outputPath));

    entry.target = next.target;
    entry.preset = next.preset;
    entry.custom = next.custom;
    entry.plan = plan;
    entry.outputPath = outputPath;
    // 改完参数后要清掉旧的失败痕迹，否则界面会显示上一次的错误
    entry.error = undefined;
    if (entry.status === 'error') entry.status = 'pending';

    this.emitQueue();
    this.pump();
    return toItem(entry);
  }

  /** 取消：进行中的杀进程；排队的直接移出队列 */
  async cancel(jobId?: string): Promise<boolean> {
    const id = jobId ?? this.activeId;
    if (!id) return false;
    const entry = this.find(id);
    if (!entry) return false;

    if (entry.status === 'pending') {
      this.drop(entry);
      this.emitQueue();
      return true;
    }
    if (!entry.job) return false;
    await entry.job.cancel();
    return true;
  }

  /** 移除任务（失败任务、排队任务）；运行中必须先取消 */
  remove(jobId: string): QueueSnapshot {
    const entry = this.mustFind(jobId);
    if (!canRemoveTask(entry.status)) {
      throw new AppError('E_BAD_REQUEST', '任务正在处理中，请先取消再删除。');
    }
    this.drop(entry);
    // 把卡住队列的那条失败任务删掉后，队列应该自己继续
    if (this.paused && this.pausedReason === 'failure' && !this.hasFailure()) {
      this.paused = false;
      this.pausedReason = null;
    }
    this.emitQueue();
    this.pump();
    return this.list();
  }

  /** 重试失败任务：重新规划 + 重新预定路径，jobId 保持不变 */
  retry(jobId: string): QueueSnapshot {
    const entry = this.mustFind(jobId);
    if (!canRetryTask(entry.status)) {
      throw new AppError('E_BAD_REQUEST', '只有失败或已取消的任务可以重试。');
    }

    this.reserved.delete(norm(entry.outputPath));
    const plan = planConversion({
      meta: entry.meta,
      target: entry.target,
      options: { preset: entry.preset },
    });
    const outputPath = resolveOutputPath(entry.meta.path, entry.target, {
      outputDir: entry.outputDir,
      exists: (p) => this.exists(p),
    });
    this.reserved.add(norm(outputPath));

    entry.plan = plan;
    entry.outputPath = outputPath;
    entry.status = 'pending';
    entry.error = undefined;
    entry.progress = undefined;
    entry.result = undefined;

    // 用户对失败任务动手了，队列不该继续卡着
    if (this.paused && this.pausedReason === 'failure') {
      this.paused = false;
      this.pausedReason = null;
    }
    this.emitQueue();
    this.pump();
    return this.list();
  }

  resume(): QueueSnapshot {
    if (this.paused) {
      this.paused = false;
      this.pausedReason = null;
      this.emitQueue();
      this.pump();
    }
    return this.list();
  }

  /** 应用退出前调用，避免 ffmpeg 变成孤儿进程 */
  async dispose(): Promise<void> {
    const active = this.activeId ? this.find(this.activeId) : null;
    await active?.job?.cancel();
  }

  /* ── 内部 ─────────────────────────────────────────────── */

  private pump(): void {
    if (this.paused) return;
    if (this.activeId) return;
    const next = this.entries.find((e) => e.status === 'pending');
    if (!next) return;

    this.activeId = next.jobId;
    next.status = 'preparing';
    const job = new ConversionJob({
      // 关键：沿用队列条目的 jobId，事件与卡片才对得上
      jobId: next.jobId,
      meta: next.meta,
      plan: next.plan,
      outputPath: next.outputPath,
      target: next.target,
      onProgress: (payload) => {
        next.progress = payload;
        this.sink.onProgress?.(payload);
        this.emitQueue();
      },
      onState: (snapshot) => this.handleState(next, snapshot),
    });
    next.job = job;
    this.emitQueue();

    // 故意不 await：转码可能几分钟，入队/继续操作必须立刻返回
    void job.run();
  }

  private handleState(entry: Entry, snapshot: JobSnapshot): void {
    entry.status = snapshot.status;
    if (snapshot.progress) entry.progress = snapshot.progress;
    if (snapshot.result) entry.result = snapshot.result;
    if (snapshot.error) entry.error = snapshot.error;

    this.sink.onState?.(snapshot);

    const terminal =
      snapshot.status === 'done' || snapshot.status === 'error' || snapshot.status === 'cancelled';
    if (!terminal) {
      this.emitQueue();
      return;
    }

    entry.job = null;
    this.reserved.delete(norm(entry.outputPath));
    if (this.activeId === entry.jobId) this.activeId = null;
    this.lastSnapshot = snapshot;

    if (snapshot.status === 'done' || snapshot.status === 'cancelled') {
      // 成功的结果进历史；取消没有结果。两者都不该继续占着队列
      this.drop(entry);
    } else if (this.policy() === 'pause') {
      // 失败即暂停：留在队列里标红，等用户重试、删除或手动继续
      this.paused = true;
      this.pausedReason = 'failure';
    }

    this.emitQueue();
    this.pump();
  }

  private drop(entry: Entry): void {
    this.reserved.delete(norm(entry.outputPath));
    this.entries = this.entries.filter((e) => e.jobId !== entry.jobId);
  }

  private mustFind(jobId: string): Entry {
    const entry = this.find(jobId);
    if (!entry) {
      throw new AppError('E_BAD_REQUEST', '任务不存在或已结束。', { detail: jobId });
    }
    return entry;
  }

  private hasFailure(): boolean {
    return this.entries.some((e) => e.status === 'error');
  }

  private emitQueue(): void {
    this.sink.onQueue?.(this.list());
  }
}

function toItem(entry: Entry): QueueItem {
  return {
    jobId: entry.jobId,
    fileName: entry.meta.fileName,
    sourcePath: entry.meta.path,
    outputPath: entry.outputPath,
    target: entry.target,
    preset: entry.preset,
    custom: entry.custom,
    status: entry.status,
    mode: entry.plan?.mode ?? null,
    sourceSizeBytes: entry.meta.sizeBytes,
    progress: entry.progress,
    result: entry.result,
    error: entry.error,
    createdAt: entry.createdAt,
  };
}

function activeJobSnapshot(entry: Entry): JobSnapshot {
  return {
    status: entry.status,
    jobId: entry.jobId,
    fileName: entry.meta.fileName,
    sourcePath: entry.meta.path,
    target: entry.target,
    progress: entry.progress,
    result: entry.result,
    error: entry.error,
  };
}

/**
 * 进程内单例。
 *
 * 策略与模式在运行时从设置里读（而不是构造时固化）：
 * 用户可以在任务进行中去设置页改「失败策略」，下一次失败就该按新策略走。
 */
export const jobManager = new JobManager();
