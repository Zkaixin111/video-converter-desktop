/**
 * 转换页「待转换批次」的数量规则。
 *
 * 为什么单独抽成一个纯函数文件：上限有**两条**，而且会同时生效——
 *   · 单次添加 ≤ 10（一次框选 15 个，只收前 10 个）
 *   · 待转换总数 ≤ 10（已有 6 个，再加 8 个，只收 4 个）
 * 两个约束叠在一起，写在组件里必然是「有的入口拦了、有的入口没拦」。
 * 这里统一出结论 + 一句可直接显示的中文提示，组件只负责把提示弹出来。
 *
 * ⚠️ 本文件必须保持纯：不得 import node:* / electron（渲染进程也要用）。
 */

/** 待转换批次的总数上限 */
export const MAX_BATCH_TOTAL = 10;
/** 单次添加的数量上限（与总数上限同值，但语义独立） */
export const MAX_BATCH_ONCE = 10;

/** 被哪条规则卡住：单次上限 / 总数上限 */
export type LimitReason = 'once' | 'total';

export interface LimitResult<T> {
  /** 按原顺序保留的部分 */
  accepted: T[];
  /** 被拒掉的数量 */
  rejected: number;
  /** null = 全部收下 */
  reason: LimitReason | null;
}

/** 还剩几个空位（用于界面上的「已选 3/10」与按钮禁用判定） */
export function remainingSlots(existingCount: number, cap = MAX_BATCH_TOTAL): number {
  const used = Number.isFinite(existingCount) ? Math.max(0, Math.floor(existingCount)) : 0;
  return Math.max(0, cap - used);
}

/**
 * 计算这次能收下几条。
 *
 * 顺序很重要：先看总数是否已满，再取「单次上限」与「剩余空位」的较小值。
 * 判定 reason 时以「哪个约束真正把数量压下来了」为准——
 * 已有 6 个时再选 15 个，真正的原因是总数，提示就该说总数，而不是「一次最多 10 个」。
 */
export function limitAdd<T>(
  items: T[],
  existingCount: number,
  cap = MAX_BATCH_TOTAL,
  once = MAX_BATCH_ONCE,
): LimitResult<T> {
  if (items.length === 0) return { accepted: [], rejected: 0, reason: null };

  const remaining = remainingSlots(existingCount, cap);
  if (remaining === 0) return { accepted: [], rejected: items.length, reason: 'total' };

  // 单次上限本身也不能超过总数上限（防止有人把 once 配得更大）
  const onceAllowed = Math.min(items.length, once, cap);
  const take = Math.min(onceAllowed, remaining);

  const accepted = items.slice(0, take);
  const reason: LimitReason | null =
    take === items.length ? null : take < onceAllowed ? 'total' : 'once';

  return { accepted, rejected: items.length - take, reason };
}

/**
 * 给用户看的一句话。
 *
 * 三种情况分开说，因为用户接下来要做的事不一样：
 *   · 已经满了 → 告诉他怎么腾出位置
 *   · 单次超了 → 告诉他这次只收了前 N 个
 *   · 总数超了 → 告诉他总数上限，并点明「已有几个」
 */
export function limitMessage(
  result: LimitResult<unknown>,
  existingCount: number,
  cap = MAX_BATCH_TOTAL,
): string | null {
  if (!result.reason) return null;

  const existing = Math.max(0, Math.floor(existingCount) || 0);
  const taken = result.accepted.length;

  if (taken === 0) {
    return `最多同时转换 ${cap} 个视频，请先转换或移除部分文件再加`;
  }
  if (result.reason === 'once') {
    return `一次最多添加 ${cap} 个视频，这次只加入前 ${taken} 个`;
  }
  return `最多同时转换 ${cap} 个视频，这次加入了 ${taken} 个（已有 ${existing} 个）`;
}
