import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 类名合并（shadcn/ui 同构写法）。
 * - clsx：按条件拼装
 * - twMerge：后写的 Tailwind 工具类覆盖前面的同类冲突，避免出现两套间距打架
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
