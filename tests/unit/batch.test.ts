/**
 * 待转换批次数量规则的单测。
 *
 * 这两条上限（单次 10 / 总数 10）会同时生效，边界组合特别多：
 * 空列表、刚好 10、已有 6 再选 8、已满 10 再选 1、一次选 15……
 * 每一种的「收下几条」和「提示哪句话」都不一样，所以逐条钉死。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_BATCH_ONCE,
  MAX_BATCH_TOTAL,
  limitAdd,
  limitMessage,
  remainingSlots,
} from '../../src/shared/batch';

const nums = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('上限常量', () => {
  it('单次与总数上限都是 10（产品规格）', () => {
    expect(MAX_BATCH_TOTAL).toBe(10);
    expect(MAX_BATCH_ONCE).toBe(10);
  });
});

describe('remainingSlots', () => {
  it('按已用数量算剩余空位', () => {
    expect(remainingSlots(0)).toBe(10);
    expect(remainingSlots(3)).toBe(7);
    expect(remainingSlots(10)).toBe(0);
  });

  it('越界输入不会算出负数或 NaN', () => {
    expect(remainingSlots(99)).toBe(0);
    expect(remainingSlots(-3)).toBe(10);
    expect(remainingSlots(Number.NaN)).toBe(10);
  });
});

describe('limitAdd · 能收几条', () => {
  it('空添加什么都不做', () => {
    const r = limitAdd([], 0);
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toBe(0);
    expect(r.reason).toBeNull();
  });

  it('没到上限就全部收下', () => {
    const r = limitAdd(nums(3), 0);
    expect(r.accepted).toEqual([1, 2, 3]);
    expect(r.reason).toBeNull();
  });

  it('刚好 10 个也全部收下（边界不提前拦截）', () => {
    const r = limitAdd(nums(10), 0);
    expect(r.accepted).toHaveLength(10);
    expect(r.reason).toBeNull();
  });

  it('一次选 15 个：只收前 10 个，原因是一单次超限', () => {
    const r = limitAdd(nums(15), 0);
    expect(r.accepted).toEqual(nums(10));
    expect(r.rejected).toBe(5);
    expect(r.reason).toBe('once');
  });

  it('已有 6 个再加 8 个：只收 4 个，原因是总数超限', () => {
    const r = limitAdd(nums(8), 6);
    expect(r.accepted).toEqual([1, 2, 3, 4]);
    expect(r.rejected).toBe(4);
    expect(r.reason).toBe('total');
  });

  it('已有 6 个再加 15 个：真正卡住的是总数（收 4 个），不是单次', () => {
    const r = limitAdd(nums(15), 6);
    expect(r.accepted).toHaveLength(4);
    expect(r.reason).toBe('total');
  });

  it('已经满 10 个：一个都不收', () => {
    const r = limitAdd(nums(3), 10);
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toBe(3);
    expect(r.reason).toBe('total');
  });

  it('保持原顺序（不能因为截断把后面的顶上来）', () => {
    const r = limitAdd(['a', 'b', 'c', 'd'], 8);
    expect(r.accepted).toEqual(['a', 'b']);
  });

  it('自定义上限：单次上限配得比总数小时以单次为准', () => {
    const r = limitAdd(nums(10), 0, 10, 3);
    expect(r.accepted).toEqual([1, 2, 3]);
    expect(r.reason).toBe('once');
  });
});

describe('limitMessage · 提示文案', () => {
  it('没超限时不出提示', () => {
    expect(limitMessage(limitAdd(nums(2), 0), 0)).toBeNull();
  });

  it('已满：告诉用户怎么腾位置，而不是只报「不能加」', () => {
    const msg = limitMessage(limitAdd(nums(1), 10), 10);
    expect(msg).toContain('10');
    expect(msg).toMatch(/先转换或移除/);
  });

  it('单次超限：说明这次只加入了前 N 个', () => {
    const msg = limitMessage(limitAdd(nums(15), 0), 0);
    expect(msg).toContain('一次最多添加 10 个');
    expect(msg).toContain('前 10 个');
  });

  it('总数超限：说明加入了几个、已有几个', () => {
    const msg = limitMessage(limitAdd(nums(8), 6), 6);
    expect(msg).toContain('最多同时转换 10 个');
    expect(msg).toContain('4 个');
    expect(msg).toContain('已有 6 个');
  });

  it('提示文字都是中文（界面上不能出现英文错误串）', () => {
    const samples = [
      limitMessage(limitAdd(nums(1), 10), 10),
      limitMessage(limitAdd(nums(15), 0), 0),
      limitMessage(limitAdd(nums(8), 6), 6),
    ];
    for (const s of samples) {
      expect(s).toBeTruthy();
      expect(s as string).toMatch(/[\u4e00-\u9fa5]/);
    }
  });
});
