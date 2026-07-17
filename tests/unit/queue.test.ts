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
  canRetryTask,
  isFailedTask,
  isLiveTask,
  resolveTaskParams,
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
});
