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
