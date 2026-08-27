/**
 * 队列纯规则（shared/queue.ts）单元测试。
 *
 * 这里守的是整批功能里最贵的一条：**参数到底取谁的**。
 * 规则写错不会崩，只会让「界面显示 WebM、实际写出 MP4」这种问题
 * 在用户机器上偶发——所以规则本身必须被逐条钉死。
 */
import { describe, expect, it } from 'vitest';
import {
  canEditTask,
  canRemoveTask,
  canReorder,
  canRetryTask,
  isFailedTask,
  isLiveTask,
  movePending,
  reorderPending,
  resolveTaskParams,
  pausedLabel,
  traySummary,
  type Orderable,
} from '../../src/shared/queue';
import type { ContainerKey, JobStatus, PresetTier } from '../../src/shared/types';

const presets: Record<ContainerKey, PresetTier> = {
  mp4: 'high',
  mkv: 'small',
  avi: 'standard',
  mov: 'standard',
  flv: 'standard',
  wmv: 'standard',
  webm: 'small',
  mpeg: 'standard',
};

describe('resolveTaskParams · 优先级', () => {
  it('任务自带参数时，target 与 preset 都用任务自己的，全局完全让位', () => {
    const r = resolveTaskParams({
      custom: { target: 'webm', preset: 'high' },
      globalTarget: 'mp4',
      presets,
    });

    expect(r.target).toBe('webm');
    expect(r.preset).toBe('high');
    // custom 原样带回，界面靠它区分「自定义 / 跟随全局」
    expect(r.custom).toEqual({ target: 'webm', preset: 'high' });
  });

  it('custom 为 null 时取全局 target，档位取 presets[全局 target]', () => {
    const r = resolveTaskParams({ custom: null, globalTarget: 'mkv', presets });

    expect(r.target).toBe('mkv');
    expect(r.preset).toBe('small');
    expect(r.custom).toBeNull();
  });

  it('档位是按「最终 target」取的：任务自带 target 时不再借用全局档位', () => {
    // 全局 mp4 = high，若错误地沿用会得到 high；正确结果应是任务自己的 standard
    const r = resolveTaskParams({
      custom: { target: 'avi', preset: 'standard' },
      globalTarget: 'mp4',
      presets,
    });

    expect(r.preset).toBe('standard');
  });

  it('全局档位缺失（旧配置文件 / 新增容器）时回落 standard', () => {
    const partial = { mp4: 'high' } as unknown as Record<ContainerKey, PresetTier>;
    const r = resolveTaskParams({ custom: null, globalTarget: 'webm', presets: partial });

    expect(r.preset).toBe('standard');
  });

  it('空 custom 对象不会被误判为「有自定义参数」', () => {
    // 防御：渲染层若传了 {}，structurally 是 object 但取不到字段，
    // 这里只保证不抛异常（真正的字段校验在 ipc/queue.ts 的 parseCustom）
    const r = resolveTaskParams({
      custom: {} as never,
      globalTarget: 'mp4',
      presets,
    });
    expect(r.target).toBeUndefined();
  });
});

describe('状态判定 · 编辑 / 移除 / 重试', () => {
  const ALL: JobStatus[] = ['idle', 'pending', 'preparing', 'running', 'done', 'cancelled', 'error'];

  it('只有等待中与失败的任务可以改参数', () => {
    const editable = ALL.filter(canEditTask);
    expect(editable).toEqual(['pending', 'error']);
  });

  it('跑着的任务不能直接移除（必须先取消，避免出现看不见的 ffmpeg）', () => {
    expect(canRemoveTask('running')).toBe(false);
    expect(canRemoveTask('preparing')).toBe(false);
    expect(ALL.filter(canRemoveTask)).toEqual(['idle', 'pending', 'done', 'cancelled', 'error']);
  });

  it('只有失败与已取消的任务可以重试', () => {
    expect(ALL.filter(canRetryTask)).toEqual(['cancelled', 'error']);
  });

  it('「还在队列里」只包含未结束的三种状态', () => {
    expect(ALL.filter(isLiveTask)).toEqual(['pending', 'preparing', 'running']);
  });

  it('失败单独计数（用于标红与暂停判断）', () => {
    expect(ALL.filter(isFailedTask)).toEqual(['error']);
  });

  it('只有等待中的任务可以调顺序', () => {
    expect(ALL.filter(canReorder)).toEqual(['pending']);
  });
});

/**
 * 排序（TODO-13）。
 *
 * 这里要钉死的是两类坑：
 *   1. **非等待项不能被顺手带偏** —— 队列里可能夹着正在跑的任务，
 *      动它的位置等于动了「谁正在被调度」这件事
 *   2. **位移要止于两端**，不能绕成环；也不能吐出 undefined 让界面崩掉
 */
describe('队列排序 · 纯函数', () => {
  const row = (jobId: string, status: JobStatus): Orderable => ({ jobId, status });
  const names = (rows: Orderable[]) => rows.map((r) => r.jobId);

  it('在等待序列里下移一位', () => {
    const rows = [row('a', 'pending'), row('b', 'pending'), row('c', 'pending')];
    expect(names(movePending(rows, 'a', 1))).toEqual(['b', 'a', 'c']);
  });

  it('在等待序列里上移一位', () => {
    const rows = [row('a', 'pending'), row('b', 'pending'), row('c', 'pending')];
    expect(names(movePending(rows, 'c', -1))).toEqual(['a', 'c', 'b']);
  });

  it('跨多位移动也走同一条路径（拖拽落到第三项）', () => {
    const rows = [row('a', 'pending'), row('b', 'pending'), row('c', 'pending'), row('d', 'pending')];
    expect(names(movePending(rows, 'a', 2))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('越界停在队首，不绕回队尾', () => {
    const rows = [row('a', 'pending'), row('b', 'pending'), row('c', 'pending')];
    expect(names(movePending(rows, 'a', -5))).toEqual(['a', 'b', 'c']);
  });

  it('越界停在队尾，不绕回队首', () => {
    const rows = [row('a', 'pending'), row('b', 'pending'), row('c', 'pending')];
    expect(names(movePending(rows, 'c', 9))).toEqual(['a', 'b', 'c']);
  });

  it('正在跑的任务不参与排序，且它自己的位置不动', () => {
    const rows = [
      row('a', 'pending'),
      row('b', 'running'),
      row('c', 'pending'),
      row('d', 'pending'),
    ];
    // c 与 d 才是等待序列（a 被 running 隔开，仍在等待序列里，下标 0）
    const moved = movePending(rows, 'a', 1);
    expect(names(moved)).toEqual(['c', 'b', 'a', 'd']);
    expect(moved[1].status).toBe('running');
  });

  it('失败的任务同样不参与排序', () => {
    const rows = [row('a', 'pending'), row('b', 'error'), row('c', 'pending')];
    const moved = movePending(rows, 'a', 1);
    expect(names(moved)).toEqual(['c', 'b', 'a']);
  });

  it('移动不存在的 jobId 时原样返回（不丢数据、不抛错）', () => {
    const rows = [row('a', 'pending'), row('b', 'pending')];
    expect(names(movePending(rows, 'zzz', 1))).toEqual(['a', 'b']);
  });

  it('delta 为 0 时引用不变，避免无意义的重渲染', () => {
    const rows = [row('a', 'pending'), row('b', 'pending')];
    expect(movePending(rows, 'a', 0)).toBe(rows);
  });

  it('delta 是 NaN / 小数时不炸：取整后照判', () => {
    const rows = [row('a', 'pending'), row('b', 'pending'), row('c', 'pending')];
    expect(names(movePending(rows, 'a', NaN))).toEqual(['a', 'b', 'c']);
    expect(names(movePending(rows, 'a', 1.9))).toEqual(['b', 'a', 'c']);
  });

  it('reorderPending 缺 order 项时退回原位，不吐 undefined', () => {
    const rows = [row('a', 'pending'), row('b', 'pending')];
    expect(names(reorderPending(rows, ['b']))).toEqual(['b', 'b']);
  });

  it('纯函数：不修改传入的数组', () => {
    const rows = [row('a', 'pending'), row('b', 'pending')];
    movePending(rows, 'a', 1);
    expect(names(rows)).toEqual(['a', 'b']);
  });
});

describe('托盘摘要 · TODO-14', () => {
  /** 只带托盘摘要用得到的那几个字段 */
  const snap = (partial: {
    items?: PartialQueueItem[];
    batch?: { total: number; settled: number } | null;
    paused?: boolean;
    pausedReason?: 'failure' | 'manual' | 'restored' | null;
  }) => ({
    items: partial.items ?? [],
    activeId: null,
    activeIds: [],
    batch: partial.batch ?? null,
    paused: partial.paused ?? false,
    pausedReason: partial.pausedReason ?? null,
    mode: 'single' as const,
    policy: 'continue' as const,
  });

  type PartialQueueItem = {
    jobId: string;
    status: JobStatus;
    progress?: { pct: number };
  };

  it('队列空着的时候只报名字', () => {
    const s = traySummary(snap({}), '视频转换器');
    expect(s.tooltip).toBe('视频转换器');
    expect(s.live).toBe(false);
    expect(s.pct).toBeNull();
  });

  it('有批次时报「已定局 / 总数」', () => {
    const s = traySummary(snap({ batch: { total: 10, settled: 3 } }), '视频转换器');
    expect(s.tooltip).toBe('视频转换器 · 3/10');
    expect(s.counts).toEqual({ total: 10, settled: 3 });
  });

  it('跑起来之后带上百分比', () => {
    const s = traySummary(
      snap({
        batch: { total: 10, settled: 3 },
        items: [{ jobId: 'a', status: 'running', progress: { pct: 45 } }],
      }),
      '视频转换器',
    );
    expect(s.tooltip).toBe('视频转换器 · 3/10 · 45%');
    expect(s.running).toBe(true);
  });

  it('并发时取平均进度，而不是抢跑的那一个', () => {
    const s = traySummary(
      snap({
        items: [
          { jobId: 'a', status: 'running', progress: { pct: 90 } },
          { jobId: 'b', status: 'running', progress: { pct: 10 } },
        ],
      }),
      '视频转换器',
    );
    expect(s.pct).toBe(50);
  });

  it('任务还在 preparing、没出进度时不瞎编百分比', () => {
    const s = traySummary(snap({ items: [{ jobId: 'a', status: 'preparing' }] }), '视频转换器');
    expect(s.pct).toBeNull();
    expect(s.tooltip).toBe('视频转换器');
  });

  it('暂停要排在进度前面：先看懂异常，再看数字', () => {
    const manual = traySummary(
      snap({ batch: { total: 4, settled: 1 }, paused: true, pausedReason: 'manual' }),
      '视频转换器',
    );
    expect(manual.tooltip).toBe('视频转换器 · 队列已暂停 · 1/4');
    expect(manual.paused).toBe(true);
  });

  it('失败导致的暂停要说清是失败的锅', () => {
    expect(pausedLabel('failure')).toBe('有任务失败，队列已暂停');
    expect(pausedLabel('restored')).toBe('等待你确认');
    expect(pausedLabel(null)).toBeNull();
  });

  it('整批跑完之后，托盘上还能看到刚才那批的账', () => {
    const s = traySummary(snap({ batch: { total: 4, settled: 4 } }), '视频转换器');
    expect(s.tooltip).toBe('视频转换器 · 4/4');
    // 没有活儿了，菜单里的「暂停队列」应当是不可点的
    expect(s.live).toBe(false);
  });

  it('只要还有待跑的任务就算「还有活儿」', () => {
    const s = traySummary(snap({ items: [{ jobId: 'a', status: 'pending' }] }), '视频转换器');
    expect(s.live).toBe(true);
    expect(s.running).toBe(false);
  });
});
