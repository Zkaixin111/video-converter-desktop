/**
 * 队列的纯规则（无 IO、无 electron、无时间戳），主进程与渲染进程共用。
 *
 * 把「参数到底取谁的」这一条抽成函数是整批功能里最容易出错的地方：
 * 任务自带参数优先于全局，而全局档位又是「按目标容器分别配置」的，
 * 两个维度叠在一起，写在组件里迟早会出现前后端算出不同结果的 bug。
 */
import type {
  ContainerKey,
  JobStatus,
  PresetTier,
  QueueSnapshot,
  TaskParams,
} from './types';

/** 并发上限（TODO-10）：再高就不是「同时转 4 个」而是「每个都变慢 4 倍」 */
export const CONCURRENCY_MIN = 1;
export const CONCURRENCY_MAX = 4;

/**
 * 并发数钳到 1–4。
 *
 * 钳住而不是报错：并发数是**偏好**（机器有 16 核就敢填 16），
 * 但超过 4 会让每个 ffmpeg 都在抢 CPU，总时间反而变长。
 * 脏值（NaN / 小数 / 负数）一律回落到 1 —— 也就是老版本的串行行为。
 */
export function clampConcurrency(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : CONCURRENCY_MIN;
  return Math.min(CONCURRENCY_MAX, Math.max(CONCURRENCY_MIN, v));
}

export interface ResolveInput {
  /** 任务自带参数；null 表示跟随全局 */
  custom: TaskParams | null;
  /** 全局参数面板当前选中的目标格式 */
  globalTarget: ContainerKey;
  /** 各容器的全局档位（来自参数预设页） */
  presets: Record<ContainerKey, PresetTier>;
}

export interface ResolvedParams {
  target: ContainerKey;
  preset: PresetTier;
  /** 原样带回，便于调用方判定「是否自定义」 */
  custom: TaskParams | null;
}

/**
 * 解析一条任务最终生效的参数。
 *
 * 优先级：**任务自带 custom > 全局参数**
 *   · custom 有值 → 直接用它的 target 与 preset（连档位一起覆盖）
 *   · custom 为 null → 用全局 target，档位取 presets[target]
 *
 * 注意档位是按「最终 target」取的：如果任务自带 target，全局档位不再参与。
 */
export function resolveTaskParams(input: ResolveInput): ResolvedParams {
  const { custom, globalTarget, presets } = input;
  if (custom) {
    return { target: custom.target, preset: custom.preset, custom };
  }
  return {
    target: globalTarget,
    preset: presets[globalTarget] ?? 'standard',
    custom: null,
  };
}

/** 只有还没开始跑、或已经失败的任务可以改参数 */
export function canEditTask(status: JobStatus): boolean {
  return status === 'pending' || status === 'error';
}

/** 跑着的任务必须先取消才能移除，避免队列里出现「看不见但还在跑」的 ffmpeg */
export function canRemoveTask(status: JobStatus): boolean {
  return status !== 'running' && status !== 'preparing';
}

/** 失败与已取消的任务可以重试（已在跑的不能） */
export function canRetryTask(status: JobStatus): boolean {
  return status === 'error' || status === 'cancelled';
}

/** 队列里未结束的任务（用于角标与「进行中」区块） */
export function isLiveTask(status: JobStatus): boolean {
  return status === 'pending' || status === 'preparing' || status === 'running';
}

/** 失败的任务单独计数，供界面标红与暂停提示 */
export function isFailedTask(status: JobStatus): boolean {
  return status === 'error';
}

/* ── 排序（TODO-13） ───────────────────────────────────── */

/**
 * 只有**等待中**的任务能挪位置。
 *
 * 正在跑的挪不动（ queues 语义里它已经挣脱了队列），
 * 已失败的挪了也没意义——它需要的是重试或删除，不是换个位次再来一次。
 */
export function canReorder(status: JobStatus): boolean {
  return status === 'pending';
}

/** 能被排序的最小形状：队列条目（渲染层）与内部 Entry（主进程）都满足 */
export interface Orderable {
  jobId: string;
  status: JobStatus;
}

/**
 * 按给定的 pending 顺序重排列表，**非 pending 的条目原地不动**。
 *
 * 为什么不直接「从原位置抽出来塞到目标位置」：
 * 队列里正在跑的任务可能排在前面（并发 > 1 时更明显），抽出再插入会连带
 * 改变非等待项的位置。把两件事分开更好推理：**非等待项守住自己的位置，
 * 等待项按新顺序填进等待项的槽位**。
 */
export function reorderPending<T extends Orderable>(items: T[], order: string[]): T[] {
  const byId = new Map(items.map((i) => [i.jobId, i]));
  let cursor = 0;
  return items.map((item) => {
    if (item.status !== 'pending') return item;
    const wanted = order[cursor];
    cursor += 1;
    // order 里没有对应项（调用方算错）时退回原位，总比重排出 undefined 好
    return wanted ? (byId.get(wanted) ?? item) : item;
  });
}

/**
 * 把某个等待中的任务在**等待序列里**移动 `delta` 位（负数上移、正数下移）。
 *
 * 参数用「移动几位」而不是「移到第几位」：拖拽落到某一行、键盘 Alt+↑/↓
 * 都能很自然地换算成同一个输入，两种交互共用一条执行路径。
 * 越界自动停在两端，不会绕回队尾 —— 绕回是最反直觉的一种约定。
 */
export function movePending<T extends Orderable>(items: T[], jobId: string, delta: number): T[] {
  const order = items.filter((i) => i.status === 'pending').map((i) => i.jobId);
  const from = order.indexOf(jobId);
  if (from < 0) return items;
  const rawTo = from + (Number.isFinite(delta) ? Math.trunc(delta) : 0);
  const to = Math.min(order.length - 1, Math.max(0, rawTo));
  if (to === from) return items;

  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, jobId);
  return reorderPending(items, next);
}

/* ── 托盘摘要（TODO-14） ─────────────────────────────── */

/** 暂停原因的短标签：托盘 tooltip 和菜单都只放得下一句话 */
const PAUSED_LABEL: Record<NonNullable<QueueSnapshot['pausedReason']>, string> = {
  failure: '有任务失败，队列已暂停',
  manual: '队列已暂停',
  restored: '等待你确认',
};

export function pausedLabel(reason: QueueSnapshot['pausedReason']): string | null {
  return reason ? PAUSED_LABEL[reason] : null;
}

export interface TraySummary {
  /** 队列里还有活儿吗（在跑 + 在等） */
  live: boolean;
  /** 有任务正在跑吗 */
  running: boolean;
  /** 队列是否处于暂停（菜单要给的是「继续」还是「暂停」，取决于它） */
  paused: boolean;
  /** 已定局 / 总数；没有批次时给 null */
  counts: { settled: number; total: number } | null;
  /** 在跑任务的平均进度（0–99）；还没出进度时为 null */
  pct: number | null;
  /** tooltip 全文 */
  tooltip: string;
  /**  tray 菜单里的状态行 */
  statusLine: string;
}

/**
 * 托盘要显示的那句话（TODO-14）。
 *
 * 窗口藏起来之后，用户唯一能看到的就是这一行字，所以它的取舍是
 * **先说异常、再说进度**：「有任务失败，队列已暂停」比「3/10」重要得多，
 * 而一个还在跑的百分比，恰好回答了「它是不是真的还在转」。
 */
export function traySummary(snapshot: QueueSnapshot, appName: string): TraySummary {
  const items = snapshot.items ?? [];
  const live = items.some((i) => isLiveTask(i.status));
  const running = items.some((i) => i.status === 'running' || i.status === 'preparing');

  const pcts = items
    .filter((i) => (i.status === 'running' || i.status === 'preparing') && i.progress)
    .map((i) => i.progress?.pct ?? 0);
  // 并发时取平均：某个任务跑到 90% 而另一个刚起步，报哪个都不诚实
  const pct = pcts.length > 0 ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;

  const counts = snapshot.batch ?? null;

  const parts: string[] = [];
  if (counts) parts.push(`${counts.settled}/${counts.total}`);
  if (pct !== null) parts.push(`${pct}%`);

  const label = pausedLabel(snapshot.pausedReason);
  if (label) parts.unshift(label);

  const detail = parts.join(' · ');
  return {
    live,
    running,
    paused: snapshot.paused === true,
    counts,
    pct,
    tooltip: detail ? `${appName} · ${detail}` : appName,
    statusLine: detail || (appName ?? ''),
  };
}
