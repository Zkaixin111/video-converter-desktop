/**
 * 任务调度：单并发 FIFO 队列。
 *
 * 从 MVP 的「单任务」升级到队列，核心只有一句话：
 * **同一时刻仍然只跑一个 ffmpeg**（并发会抢 CPU、让进度失去意义、让失败归因变难），
 * 但排队、编辑、重试、失败暂停这些都属于队列层的事。
 *
 * 七条硬规则：
 *   1. 单并发：`activeId` 非空时绝不再 pump
 *   2. 输出路径在**入队时**就预定（`reserved` 集合），否则两个同名任务会算出同一个路径
 *   3. 完成/取消的任务立刻移出队列（结果进历史），失败的任务留在队列里标红等人处理
 *   4. 「失败即暂停」在**失败那一刻**读取设置，用户中途改设置也能生效
 *   5. 重试 = 重新规划 + 重新预定路径 + 状态回 pending，jobId 不变（日志与历史能对上）
 *   6. 所有终态都要释放预定、清空 activeId，然后 pump 下一个
 *   7. 崩溃恢复（TODO-12）**不允许自动开跑**：restore() 只重建条目并保持暂停，
 *      用户确认（甚至先改几个参数）之后才继续。批量任务重跑一遍很贵，
 *      「自作主张」在这里比「多问一句」危险得多
 */
import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { AppError, toAppError } from '../../../shared/errors';
import { canEditTask, canRemoveTask, canRetryTask, clampConcurrency } from '../../../shared/queue';
import type {
  AudioFormat,
  AudioPlanResult,
  BatchSummary,
  ContainerKey,
  ConversionMode,
  FailurePolicy,
  JobSnapshot,
  ConflictPolicy,
  MediaMeta,
  PersistedQueueItem,
  PlanResult,
  PresetTier,
  ProgressPayload,
  QueueItem,
  QualityOverrides,
  QueueMode,
  QueueSnapshot,
  TaskParams,
} from '../../../shared/types';
import { DEFAULT_TEMPLATE } from '../../../shared/outputName';
import { planAudioExtraction, planConversion } from '../ffmpeg/planner';
import { resolveAudioPath, resolveOutputPath, type ResolveOptions } from '../fs/outputPath';
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
  /** 非空 = 这条是音频提取（TODO-20），此时 target 不参与编码 */
  audio?: AudioFormat | null;
}

export interface EnqueuedJob {
  item: QueueItem;
  /** 视频规划的产物；音频提取任务为 null */
  plan: PlanResult | null;
  /** 音频提取规划的产物；视频任务为 null */
  audioPlan: AudioPlanResult | null;
}

/**
 * 任务执行器的最小接口（TODO-10 起可注入）。
 *
 * 队列关心的是「发号施令」，不关心「谁在跑」：调度逻辑（并发、顺序、暂停）
 * 单元测试时必须脱离 ffmpeg，否则起 10 个转码进程的测试根本没法写。
 */
export interface JobRunner {
  run(): Promise<unknown>;
  cancel(): Promise<void>;
}

/**
 * 「可执行计划」的最小视图。
 *
 * ConversionJob 真正用到的只有 args / mode / preset 三样，
 * 收窄成这个接口后，音频提取计划（没有视频流、没有 QualitySpec）也能直接跑，
 * 不必为了对齐 PlanResult 去编造一个假的画质规格。
 */
export interface RunnablePlan {
  args: string[];
  mode: ConversionMode;
  preset: PresetTier;
}

export interface JobFactoryOptions {
  jobId: string;
  meta: MediaMeta;
  plan: RunnablePlan;
  outputPath: string;
  target: ContainerKey;
  /**
   * 并发时的单任务线程上限（TODO-10）。
   * null = 不限制：串行时交给 ffmpeg 自己决定，args 与老版本完全一致。
   */
  threads?: number | null;
  /** 音频提取产物（TODO-20）：校验时不再要求有视频流 */
  audioOnly?: boolean;
  /** 音频目标格式（TODO-20）：原样透传给 ConversionJob，快照与历史都要用 */
  audio?: AudioFormat | null;
  onProgress?: (payload: ProgressPayload) => void;
  onState?: (snapshot: JobSnapshot) => void;
}

/** 默认实现就是真的 ConversionJob（真去起 ffmpeg） */
const realJob: JobFactory = (opts) => new ConversionJob(opts);

export type JobFactory = (opts: JobFactoryOptions) => JobRunner;

/** 外部依赖全部可注入，方便集成测试构造不同策略 */
export interface JobManagerDeps {
  /** 失败策略：每次失败时读取，不缓存 */
  getPolicy?: () => FailurePolicy;
  /** 队列模式：仅用于快照展示，不参与调度 */
  getMode?: () => QueueMode;
  /**
   * 精细调节参数：按目标格式取。
   * 与策略/模式一样走运行期注入 —— JobManager 不认识「设置」这个概念。
   */
  getOverrides?: (target: ContainerKey) => QualityOverrides | null;
  /** 输出命名模板与重名策略（TODO-02） */
  getNaming?: () => { template: string; conflict: ConflictPolicy };
  exists?: (p: string) => boolean;
  /**
   * 任务工厂（TODO-10）。
   * 缺省是真 ConversionJob；单测注入假实现即可脱离 ffmpeg 验证调度。
   */
  createJob?: JobFactory;
  /** 同时跑几个（TODO-10）；缺省 1，即老版本的串行行为 */
  getConcurrency?: () => number;
}

export interface JobManagerSink {
  onQueue?: (snapshot: QueueSnapshot) => void;
  onProgress?: (payload: ProgressPayload) => void;
  onState?: (snapshot: JobSnapshot) => void;
  /** 队列彻底排空时汇报这一批的账（TODO-08）：用于聚合通知，而不是每个文件一条 */
  onBatchFinished?: (summary: BatchSummary) => void;
}

interface Entry {
  jobId: string;
  meta: MediaMeta;
  target: ContainerKey;
  preset: PresetTier;
  custom: TaskParams | null;
  outputDir: string | null;
  outputPath: string;
  /** 非空 = 音频提取任务（TODO-20），此时 `plan` 为 null、`audioPlan` 有值 */
  audio: AudioFormat | null;
  plan: PlanResult | null;
  audioPlan: AudioPlanResult | null;
  status: QueueItem['status'];
  /**
   * 这条是从上次崩溃里恢复出来的「没转完」的任务（TODO-12）。
   * 保留到它真正跑完为止：界面要靠它解释「为什么会有这么一排任务」。
   */
  interrupted: boolean;
  progress?: ProgressPayload;
  result?: QueueItem['result'];
  error?: QueueItem['error'];
  createdAt: number;
  job: JobRunner | null;
}

/** Windows 路径大小写不敏感，预定表统一小写比较 */
function norm(p: string): string {
  return p.toLowerCase();
}

/**
 * 把队列条目的规划结果收窄成「可执行计划」。
 *
 * 音频提取直接抽轨时视作 `copy`（很快、不重编码），需要转码时视作 `transcode`
 * —— 进度条与「预计耗时」靠这个区分，与视频那套口径一致。
 */
function runnablePlan(entry: Entry): RunnablePlan | null {
  if (entry.audioPlan) {
    const p = entry.audioPlan;
    return {
      args: p.args,
      mode: p.audioAction === 'copy' ? 'copy' : 'transcode',
      preset: p.preset,
    };
  }
  if (entry.plan) {
    return { args: entry.plan.args, mode: entry.plan.mode, preset: entry.plan.preset };
  }
  return null;
}

export class JobManager {
  private entries: Entry[] = [];
  /**
   * 正在跑的任务（TODO-10）。
   *
   * 从单个 `activeId` 换成集合：并发时「当前任务」不再唯一。
   * 对外仍保留 `activeId`，取**最早**在跑的那个 —— 转换页的进度卡、
   * 不带参数的 cancel 都以它为默认目标，语义与串行时一致。
   */
  private activeIds = new Set<string>();
  private paused = false;
  /** `failure` 失败即暂停、`manual` 用户主动暂停（TODO-13）、`restored` 崩溃恢复待确认（TODO-12） */
  private pausedReason: QueueSnapshot['pausedReason'] = null;
  private reserved = new Set<string>();
  private sink: JobManagerSink = {};
  private lastSnapshot: JobSnapshot = { status: 'idle' };
  /**
   * 当前这一批的结局账（TODO-08）。
   *
   * 它是「跨任务」的：一个任务结束只贡献一个计数，
   * 队列彻底排空（既没有在跑的也没有在等的）时才结算并清零。
   * 这样 10 个文件只会有**一条**汇总通知，而不是 10 条。
   */
  private tally: BatchSummary = { done: 0, failed: 0, cancelled: 0 };
  /** 这一批一共入队了多少条（TODO-10）：并发下「还剩几个」要靠它算 */
  private batchTotal = 0;

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

  private overrides(target: ContainerKey): QualityOverrides | null {
    try {
      return this.deps.getOverrides?.(target) ?? null;
    } catch {
      // 手动画质参数是「锦上添花」，读不到就按档位走，绝不能因此让入队失败
      return null;
    }
  }

  private naming(): { template: string; conflict: ConflictPolicy } {
    try {
      return this.deps.getNaming?.() ?? { template: DEFAULT_TEMPLATE, conflict: 'rename' };
    } catch {
      return { template: DEFAULT_TEMPLATE, conflict: 'rename' };
    }
  }

  private policy(): FailurePolicy {
    return this.deps.getPolicy?.() ?? 'continue';
  }

  private exists(p: string): boolean {
    if (this.reserved.has(norm(p))) return true;
    return (this.deps.exists ?? fs.existsSync)(p);
  }

  private makeJob(opts: JobFactoryOptions): JobRunner {
    return (this.deps.createJob ?? realJob)(opts);
  }

  /** 并发数（TODO-10）：读不到就按 1，串行永远是最安全的行为 */
  private concurrency(): number {
    try {
      return clampConcurrency(this.deps.getConcurrency?.() ?? 1);
    } catch {
      return 1;
    }
  }

  /**
   * 「当前任务」= 队列里最早进入运行态的那条。
   *
   * 并发 > 1 时有多条在跑，但转换页的进度卡、不带参数的 cancel
   * 都需要一个确定答案；取最早那条能保证并发 1 时与老行为完全一致。
   */
  private activeIdNow(): string | null {
    return this.entries.find((e) => e.status === 'preparing' || e.status === 'running')?.jobId ?? null;
  }

  isBusy(): boolean {
    return this.activeIds.size > 0;
  }

  /** 队列里还有活儿吗（在跑的 + 在等的） */
  private hasLiveWork(): boolean {
    return this.entries.some(
      (e) => e.status === 'pending' || e.status === 'preparing' || e.status === 'running',
    );
  }

  /** 队列里未结束的任务（用于角标与「进行中」区块） */
  private isRunning(status: QueueItem['status']): boolean {
    return status === 'preparing' || status === 'running';
  }

  private resetTally(): void {
    this.tally = { done: 0, failed: 0, cancelled: 0 };
  }

  /**
   * 队列排空时才结算这一批（TODO-08）。
   *
   * 「失败即暂停」时队列里还压着等待中的任务，这一批就不算结束 ——
   * 用户处理完失败项、剩下的跑完，才会收到那一条汇总通知。
   */
  private settleIfIdle(): void {
    if (this.hasLiveWork()) return;
    const summary = { ...this.tally };
    this.resetTally();
    this.batchTotal = 0;
    // 一个都没跑完就说明用户是把排队任务删掉了，那不算「一批结束」
    if (summary.done + summary.failed + summary.cancelled > 0) {
      this.sink.onBatchFinished?.(summary);
    }
  }

  /**
   * 批量入队。规划与路径预定都在这里完成 ——
   * 入队即返回真实输出路径，用户不必等排到自己才知道文件会写到哪里。
   */
  enqueue(inputs: EnqueueInput[]): EnqueuedJob[] {
    if (inputs.length === 0) return [];

    const out: EnqueuedJob[] = [];
    for (const [idx, input] of inputs.entries()) {
      const audio = input.audio ?? null;
      const { plan, audioPlan } = this.planFor({
        meta: input.meta,
        target: input.target,
        preset: input.preset,
        audio,
      });

      let outputPath: string;
      try {
        outputPath = this.outputPathFor({
          meta: input.meta,
          target: input.target,
          audio,
          preset: input.preset,
          outputDir: input.outputDir ?? null,
          index: inputs.length > 1 ? idx : null,
          total: inputs.length,
        });
      } catch (err) {
        // 「同名就跳过」策略：这个文件不生成任务，其余照常入队
        if (err instanceof AppError && err.code === 'E_OUTPUT_SKIPPED') continue;
        throw err;
      }
      this.reserved.add(norm(outputPath));

      const entry: Entry = {
        jobId: randomUUID(),
        meta: input.meta,
        target: input.target,
        preset: input.preset,
        custom: input.custom,
        outputDir: input.outputDir ?? null,
        outputPath,
        audio,
        plan,
        audioPlan,
        status: 'pending',
        interrupted: false,
        createdAt: Date.now(),
        job: null,
      };
      this.entries.push(entry);
      out.push({ item: toItem(entry), plan, audioPlan });
    }

    // 入队数按真正建出来的任务算：「同名跳过」的那些没进队列，不该算进分母
    this.batchTotal += out.length;
    this.emitQueue();
    this.pump();
    return out;
  }

  list(): QueueSnapshot {
    return {
      items: this.entries.map(toItem),
      activeId: this.activeIdNow(),
      activeIds: this.entries
        .filter((e) => e.status === 'preparing' || e.status === 'running')
        .map((e) => e.jobId),
      paused: this.paused,
      pausedReason: this.pausedReason,
      mode: this.deps.getMode?.() ?? 'shared',
      policy: this.policy(),
      // 并发时「还剩几个」比「单个跑到多少」有用，所以单独给一个聚合口径
      batch:
        this.batchTotal > 0
          ? {
              total: this.batchTotal,
              settled: this.tally.done + this.tally.failed + this.tally.cancelled,
            }
          : null,
    };
  }

  /** 兼容旧接口：当前任务的快照 */
  snapshot(): JobSnapshot {
    const active = this.entries.find((e) => e.status === 'preparing' || e.status === 'running');
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
    // 音频提取任务改的是音质档位（码率），视频那一套 plan 不参与
    const { plan, audioPlan } = this.planFor({
      meta: entry.meta,
      target: next.target,
      preset: next.preset,
      audio: entry.audio,
    });
    // 改参数时用户就是想让它跑起来，重名一律按加序号处理（见 outputPathFor 的 allowSkip）
    const outputPath = this.outputPathFor({
      meta: entry.meta,
      target: next.target,
      audio: entry.audio,
      preset: next.preset,
      outputDir: entry.outputDir,
      allowSkip: false,
    });
    this.reserved.add(norm(outputPath));

    entry.target = next.target;
    entry.preset = next.preset;
    entry.custom = next.custom;
    entry.plan = plan;
    entry.audioPlan = audioPlan;
    entry.outputPath = outputPath;
    // 改完参数后要清掉旧的失败痕迹，否则界面会显示上一次的错误
    entry.error = undefined;
    if (entry.status === 'error') entry.status = 'pending';

    this.emitQueue();
    this.pump();
    return toItem(entry);
  }

  /**
   * 取消：进行中的杀进程；排队的直接移出队列。
   *
   * 不带 jobId 时只取消「当前任务」（最早那条），而不是把并发的全部杀掉 ——
   * 转换页那个「取消」按钮按下去，用户预期是停掉自己正在看的这一个。
   */
  async cancel(jobId?: string): Promise<boolean> {
    const id = jobId ?? this.activeIdNow();
    if (!id) return false;
    const entry = this.find(id);
    if (!entry) return false;

    if (entry.status === 'pending') {
      // 摘掉一条就少一条：它再也不会跑完，留着会让整体进度的分母虚高
      this.batchTotal = Math.max(0, this.batchTotal - 1);
      this.drop(entry);
      // 剩下的也没了就不算「一批结束」，账要作废，否则会混进下一批的通知
      if (!this.hasLiveWork()) {
        this.resetTally();
        this.batchTotal = 0;
      }
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
    // 摘掉一条就少一条：它再也不会跑完，留着会让整体进度的分母虚高
    if (entry.status === 'pending') this.batchTotal = Math.max(0, this.batchTotal - 1);
    this.drop(entry);
    // 把卡住队列的那条失败任务删掉后，队列应该自己继续
    if (this.paused && this.pausedReason === 'failure' && !this.hasFailure()) {
      this.paused = false;
      this.pausedReason = null;
    }
    if (!this.hasLiveWork()) {
      this.resetTally();
      this.batchTotal = 0;
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
    const { plan, audioPlan } = this.planFor({
      meta: entry.meta,
      target: entry.target,
      preset: entry.preset,
      audio: entry.audio,
    });
    // 重试同理：重试意味着「就是要转」，跳过策略在这里不成立
    const outputPath = this.outputPathFor({
      meta: entry.meta,
      target: entry.target,
      audio: entry.audio,
      preset: entry.preset,
      outputDir: entry.outputDir,
      allowSkip: false,
    });
    this.reserved.add(norm(outputPath));

    entry.plan = plan;
    entry.audioPlan = audioPlan;
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

  /**
   * 崩溃恢复（TODO-12）：把落盘的队列条目重建回来。
   *
   * 与「入队」的四处不同，落脚点都是同一句话：**别自作主张**。
   *   · **重新 plan**：跨了一次进程，编码引擎能力与精细调节设置都可能变了，
   *     沿用旧 args 会转出一个「参数与界面显示不一致」的文件
   *   · **重新定路径**：上次跑到一半可能已经留下半个文件，
   *     按当前命名规则重定能绕开它（这是「恢复不覆盖好文件」的底线）
   *   · **保持暂停**：用户确认之前一个都不跑
   *   · **源文件没了就标失败**：比排到它时抛个看不懂的 ffmpeg 错误好交代
   */
  restore(items: PersistedQueueItem[]): QueueSnapshot {
    this.entries = [];
    this.reserved.clear();
    this.activeIds.clear();
    this.resetTally();
    this.batchTotal = 0;

    for (const item of items) {
      const audio = item.audio ?? null;
      const base = {
        jobId: item.jobId,
        meta: item.meta,
        target: item.target,
        preset: item.preset,
        custom: item.custom ?? null,
        outputDir: item.outputDir ?? null,
        audio,
        createdAt: item.createdAt,
        interrupted: item.status !== 'error' && item.interrupted === true,
        job: null as JobRunner | null,
      };

      // 源文件已经不在了：这条无论如何都跑不成，趁早说清楚，别让它在队列里假排队
      if (!this.exists(item.meta.path)) {
        this.entries.push({
          ...base,
          outputPath: item.outputPath,
          plan: null,
          audioPlan: null,
          status: 'error',
          error: {
            code: 'E_FILE_NOT_FOUND',
            message: '源文件已不在原位置，这个任务没法继续了。',
            hint: '重新添加一次这个文件，或直接删除这条任务。',
          },
        });
        this.reserved.add(norm(item.outputPath));
        continue;
      }

      try {
        const { plan, audioPlan } = this.planFor({
          meta: item.meta,
          target: item.target,
          preset: item.preset,
          audio,
        });
        const outputPath = this.outputPathFor({
          meta: item.meta,
          target: item.target,
          audio,
          preset: item.preset,
          outputDir: item.outputDir ?? null,
        });
        this.reserved.add(norm(outputPath));
        this.entries.push({
          ...base,
          outputPath,
          plan,
          audioPlan,
          status: item.status === 'error' ? 'error' : 'pending',
          error: item.status === 'error' ? item.error : undefined,
        });
      } catch (err) {
        // 规划失败（例如源文件被换成了纯音频却要求转 MP4）也要留一条：
        // 静默丢弃 = 用户以为转完了，结果少了一个文件
        const e = toAppError(err);
        this.entries.push({
          ...base,
          outputPath: item.outputPath,
          plan: null,
          audioPlan: null,
          status: 'error',
          error: { code: e.code, message: e.message, hint: e.hint },
        });
        this.reserved.add(norm(item.outputPath));
      }
    }

    this.batchTotal = this.entries.length;
    // 关键：**不 pump**。用户还没看过这批任务，凭什么替他决定继续跑
    if (this.entries.length > 0) {
      this.paused = true;
      this.pausedReason = 'restored';
    }
    this.emitQueue();
    return this.list();
  }

  /**
   * 当前应该落盘的任务（TODO-12）。
   *
   * 只留三类：还没轮到的、上次轮到了但进程没了的、失败的。
   * 成功与取消的任务已经进历史（TODO-07），再恢复一次就是重复劳动。
   */
  persistable(): PersistedQueueItem[] {
    return this.entries
      .filter((e) => e.status === 'pending' || e.status === 'error' || this.isRunning(e.status))
      .map((e) => ({
        jobId: e.jobId,
        meta: e.meta,
        target: e.target,
        preset: e.preset,
        custom: e.custom,
        outputDir: e.outputDir,
        outputPath: e.outputPath,
        audio: e.audio,
        status: e.status === 'error' ? 'error' : 'pending',
        interrupted: e.interrupted || this.isRunning(e.status),
        error: e.status === 'error' ? e.error : undefined,
        createdAt: e.createdAt,
      }));
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

  /** 应用退出前调用：并发下要把**所有**在跑的都停掉，漏一个就是孤儿进程 */
  async dispose(): Promise<void> {
    const active = this.entries.filter((e) => e.status === 'preparing' || e.status === 'running');
    await Promise.all(active.map((e) => e.job?.cancel()));
  }

  /* ── 内部 ─────────────────────────────────────────────── */

  /**
   * 把等待中的任务补到并发上限（TODO-10）。
   *
   * 循环而不是 if —— 并发 3 时一次要连起 3 个。
   * 并发 1 时这个循环只会执行一次，行为与老版本逐条一致。
   */
  private pump(): void {
    if (this.paused) return;

    const limit = this.concurrency();
    // 并发 > 1 时给每个 ffmpeg 限线程：4 个各用满核，比串行 4 个还慢
    const threads = this.threadsFor(limit);

    while (this.activeIds.size < limit) {
      const next = this.entries.find((e) => e.status === 'pending');
      if (!next) return;

      const runnable = runnablePlan(next);
      if (!runnable) return;

      this.activeIds.add(next.jobId);
      next.status = 'preparing';
      const job = this.makeJob({
        // 关键：沿用队列条目的 jobId，事件与卡片才对得上
        jobId: next.jobId,
        meta: next.meta,
        plan: runnable,
        outputPath: next.outputPath,
        target: next.target,
        threads,
        audioOnly: next.audio !== null,
        audio: next.audio,
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
  }

  /**
   * 并发时的单任务线程上限。
   *
   * 串行（并发 1）返回 null —— 不加 `-threads`，让 ffmpeg 自己决定，
   * 这样并发 1 的行为与老版本**逐字节一致**（现有测试一条都不用改）。
   */
  private threadsFor(limit: number): number | null {
    if (limit <= 1) return null;
    const cores = os.cpus().length;
    if (!cores) return null;
    return Math.max(1, Math.floor(cores / limit));
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
    this.activeIds.delete(entry.jobId);
    this.lastSnapshot = snapshot;

    if (snapshot.status === 'done') this.tally.done += 1;
    else if (snapshot.status === 'error') this.tally.failed += 1;
    else this.tally.cancelled += 1;

    if (snapshot.status === 'done' || snapshot.status === 'cancelled') {
      // 成功的结果进历史；取消没有结果。两者都不该继续占着队列
      this.drop(entry);
    } else if (this.policy() === 'pause') {
      // 失败即暂停：留在队列里标红，等用户重试、删除或手动继续
      this.paused = true;
      this.pausedReason = 'failure';
    }

    this.emitQueue();
    // 必须在 drop 之后：只有移出去的条目才不算「还有活儿」
    this.settleIfIdle();
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

  /**
   * 重算一批参数对应的转码方案。
   *
   * 入队、改参数、重试、崩溃恢复四处都要做这件事，抽出来是为了防止
   * 「音频提取任务却按视频去 plan」这种只在某一处分叉才会出现的 bug。
   */
  private planFor(input: {
    meta: MediaMeta;
    target: ContainerKey;
    preset: PresetTier;
    audio: AudioFormat | null;
  }): { plan: PlanResult | null; audioPlan: AudioPlanResult | null } {
    if (input.audio) {
      return {
        plan: null,
        audioPlan: planAudioExtraction({
          meta: input.meta,
          format: input.audio,
          preset: input.preset,
        }),
      };
    }
    return {
      plan: planConversion({
        meta: input.meta,
        target: input.target,
        options: { preset: input.preset, overrides: this.overrides(input.target) },
      }),
      audioPlan: null,
    };
  }

  /**
   * 重算输出路径。
   *
   * `index` 只在**整批入队**时给：命名模板里的 `{index}` 需要知道一共有几个、
   * 这是第几个。单任务的补充性操作（改参数 / 重试 / 恢复）传 null。
   *
   * `allowSkip`: 改参数、重试都是用户明确的「我就要它跑一次」，
   * 此时「重名就跳过」策略不成立（跳过等于什么都不做），一律降级成加序号。
   */
  private outputPathFor(input: {
    meta: MediaMeta;
    target: ContainerKey;
    audio: AudioFormat | null;
    preset: PresetTier;
    outputDir: string | null;
    index?: number | null;
    total?: number;
    allowSkip?: boolean;
  }): string {
    const naming = this.naming();
    const options: ResolveOptions = {
      outputDir: input.outputDir,
      exists: (p) => this.exists(p),
      template: naming.template,
      conflict:
        naming.conflict === 'skip' && input.allowSkip === false ? 'rename' : naming.conflict,
      index: input.index ?? null,
      total: input.total ?? 1,
      preset: input.preset,
    };
    return input.audio
      ? resolveAudioPath(input.meta.path, input.audio, options)
      : resolveOutputPath(input.meta.path, input.target, options);
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
    interrupted: entry.interrupted,
    mode: runnablePlan(entry)?.mode ?? null,
    audio: entry.audio,
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
    audio: entry.audio,
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
