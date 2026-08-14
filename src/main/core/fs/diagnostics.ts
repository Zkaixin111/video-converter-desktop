/**
 * 诊断包的内容组装（TODO-11）。
 *
 * 独立于 IPC 与 zip 实现，是为了能单测「包里到底有什么」。
 * 诊断包的意义是**别人拿到就能看懂**，所以内容分三块：
 *   环境（引擎版本 / 平台）· 配置（设置快照）· 现场（日志 + 失败记录）
 * 少了任何一块，收到的人都还得再问一圈。
 *
 * 关于隐私：源文件路径**不脱敏**。
 * 诊断包是用户自己导出、自己决定发给谁的，而「哪个文件转失败」恰恰是必须留下的信息；
 * 这里刻意不含 API key、账号、历史里的完整 stderr 之外的任何东西。
 */
import type { Capabilities, HistoryEntry } from '../../../shared/types';
import type { ZipEntry } from './zip';

export interface DiagnosticInput {
  settings: unknown;
  capabilities: Capabilities | null;
  /** 最近的历史记录（含失败与取消，是最有用的现场） */
  history: HistoryEntry[];
  /** 日志文件内容；一条都没有时为空数组 */
  logs: { name: string; text: string }[];
  appVersion: string;
  now: number;
}

/** 毫秒 → 可读时间戳（诊断包是给人看的，不要甩时间戳） */
function stamp(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

function summaryText(input: DiagnosticInput): string {
  const caps = input.capabilities;
  const ffmpeg = caps?.ffmpeg;
  const failed = input.history.filter((h) => h.status !== 'done');

  const lines = [
    '视频转换器 · 诊断包',
    `导出时间：${stamp(input.now)}`,
    '',
    '—— 环境 ——',
    `应用版本：v${input.appVersion}`,
    `Electron：${caps?.app.electron ?? '未知'}`,
    `Chrome：${caps?.app.chrome ?? '未知'}`,
    `Node：${caps?.app.node ?? '未知'}`,
    `平台：${caps?.app.platform ?? '未知'}`,
    '',
    '—— 转换引擎 ——',
    `FFmpeg：${ffmpeg?.version ?? '未检测到'}`,
    `含 libx264：${ffmpeg ? (ffmpeg.hasLibx264 ? '是' : '否') : '未知'}`,
    `路径：${ffmpeg?.ffmpegPath ?? '—'}`,
    `缺失组件：${ffmpeg?.missing?.length ? ffmpeg.missing.join('、') : '无'}`,
    '',
    '—— 近期记录 ——',
    `共 ${input.history.length} 条，其中未完成 ${failed.length} 条`,
    '',
  ];

  if (failed.length > 0) {
    lines.push('—— 未完成的任务 ——');
    for (const h of failed.slice(0, 20)) {
      const reason = h.error ? `${h.error.code} ${h.error.message}` : '（无记录）';
      lines.push(`${stamp(h.finishedAt)} · ${h.fileName} → ${h.target} · ${reason}`);
    }
    lines.push('');
  }

  if (input.logs.length === 0) lines.push('（暂无日志）');

  return lines.join('\n');
}

export function buildDiagnosticEntries(input: DiagnosticInput): ZipEntry[] {
  const entries: ZipEntry[] = [
    { name: 'README.txt', data: Buffer.from(summaryText(input), 'utf8') },
    {
      name: 'settings.json',
      data: Buffer.from(JSON.stringify(input.settings, null, 2), 'utf8'),
    },
    {
      name: 'history.json',
      data: Buffer.from(JSON.stringify(input.history.slice(0, 50), null, 2), 'utf8'),
    },
  ];

  if (input.capabilities) {
    entries.push({
      name: 'capabilities.json',
      data: Buffer.from(JSON.stringify(input.capabilities, null, 2), 'utf8'),
    });
  }

  // 日志放进 logs/ 子目录：包里文件一多，平铺会看不出哪个是日志
  for (const log of input.logs) {
    entries.push({ name: `logs/${log.name}`, data: Buffer.from(log.text, 'utf8') });
  }

  return entries;
}

/** 诊断包的文件名：带时间戳，连着导两次也不会互相覆盖 */
export function diagnosticFileName(now: number): string {
  const d = new Date(now);
  const p = (n: number): string => String(n).padStart(2, '0');
  const s = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `视频转换器-诊断包-${s}.zip`;
}
