/**
 * 批次结束通知的文案（TODO-08）。
 *
 * 单独抽成纯函数是为了两件事：一是能直接单测（文案分支肉眼容易漏），
 * 二是「一批结束」的判定在主进程、而文案规则与平台无关，不该混在一起。
 *
 * 规则只有一条：**有没有失败，决定了标题的口气**。
 * 全成功说「转换完成」，掺了失败就只说「转换结束」并在正文里点名失败数——
 * 让人在点开之前就知道要不要回来处理。
 */
import type { BatchSummary } from './types';

export interface NotifyText {
  title: string;
  body: string;
}

/** 一场空（一个任务都没跑完）就不该发通知 */
export function batchNotifyText(s: BatchSummary): NotifyText | null {
  const total = s.done + s.failed + s.cancelled;
  if (total <= 0) return null;

  if (s.done > 0 && s.failed === 0 && s.cancelled === 0) {
    return { title: '转换完成', body: `${s.done} 个文件已保存。` };
  }

  const parts: string[] = [];
  if (s.done > 0) parts.push(`${s.done} 个成功`);
  if (s.failed > 0) parts.push(`${s.failed} 个失败`);
  if (s.cancelled > 0) parts.push(`${s.cancelled} 个已取消`);

  return {
    title: '转换结束',
    body: `${parts.join('、')}。${s.failed > 0 ? '可在任务队列页查看失败原因。' : ''}`,
  };
}
