/** 展示层格式化：体积、时长、百分比 */
import { CONTAINERS } from '../../../shared/containers';
import type { ContainerKey } from '../../../shared/types';

export function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2).replace(/\.?0+$/, '')} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function fmtDur(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '--:--';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export function outExt(target: ContainerKey): string {
  return CONTAINERS[target].ext;
}

/** 4.2 GB → 4.2 GB；用于 diag 文本 */
export function fmtBytesPlain(bytes: number): string {
  return fmtSize(bytes);
}

/**
 * 历史列表用的相对时间。
 *
 * 刻意不用 toLocaleString：不同 Windows 区域设置下同一个 API 会给出
 * 「2026/10/18 21:05」「18/10/2026 9:05 PM」两种完全不同的排版，
 * 列表会左右参差。这里只输出两种固定形态：今天给 HH:mm，更早给 MM-DD HH:mm。
 */
export function fmtWhen(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  const sameDay =
    d.getFullYear() === new Date(now).getFullYear() &&
    d.getMonth() === new Date(now).getMonth() &&
    d.getDate() === new Date(now).getDate();

  const diffMin = Math.floor((now - ts) / 60000);
  if (sameDay && diffMin >= 0 && diffMin < 1) return '刚刚';
  if (sameDay) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
