/**
 * 批次结束通知的文案（TODO-08）。
 *
 * 验收要点里最关键的一条是「批量时只发一条汇总」——
 * 文案函数只管怎么说，但「一个都没跑完就不说话」这条必须在这里钉死，
 * 否则界面上就会出现「转换完成：0 个文件已保存」这种空通知。
 */
import { describe, expect, it } from 'vitest';
import { batchNotifyText } from '../../src/shared/notify';

describe('batchNotifyText · 不说话的情形', () => {
  it('一个任务都没跑完时不发通知', () => {
    expect(batchNotifyText({ done: 0, failed: 0, cancelled: 0 })).toBeNull();
  });
});

describe('batchNotifyText · 全部成功', () => {
  it('单文件也发，但不说失败', () => {
    expect(batchNotifyText({ done: 1, failed: 0, cancelled: 0 })).toEqual({
      title: '转换完成',
      body: '1 个文件已保存。',
    });
  });

  it('批量成功给出总数（一条汇总，不是 N 条）', () => {
    expect(batchNotifyText({ done: 10, failed: 0, cancelled: 0 })).toEqual({
      title: '转换完成',
      body: '10 个文件已保存。',
    });
  });
});

describe('batchNotifyText · 有失败或取消', () => {
  it('掺了失败就说「结束」而不是「完成」，并点名失败数', () => {
    const got = batchNotifyText({ done: 2, failed: 1, cancelled: 0 });
    expect(got?.title).toBe('转换结束');
    expect(got?.body).toContain('2 个成功');
    expect(got?.body).toContain('1 个失败');
    expect(got?.body).toContain('失败原因');
  });

  it('取消也要报（用户是主动停的，但停了几个他得知道）', () => {
    const got = batchNotifyText({ done: 1, failed: 0, cancelled: 2 });
    expect(got?.title).toBe('转换结束');
    expect(got?.body).toContain('2 个已取消');
    // 没有失败就别提「查看失败原因」
    expect(got?.body).not.toContain('失败原因');
  });

  it('三种结局都在时按 成功/失败/取消 的固定顺序列出', () => {
    const got = batchNotifyText({ done: 3, failed: 2, cancelled: 1 });
    expect(got?.body.startsWith('3 个成功、2 个失败、1 个已取消')).toBe(true);
  });

  it('全军覆没时不假装成功', () => {
    const got = batchNotifyText({ done: 0, failed: 3, cancelled: 0 });
    expect(got?.title).toBe('转换结束');
    expect(got?.body).toContain('3 个失败');
    expect(got?.body).not.toContain('个成功');
  });
});
