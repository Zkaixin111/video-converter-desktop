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
  TaskParams,
} from './types';

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
