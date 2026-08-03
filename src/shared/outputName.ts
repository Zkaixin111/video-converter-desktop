/**
 * 输出文件名模板渲染（纯函数，渲染层也能直接用它做实时预览）。
 *
 * 三条规则：
 *   1. **默认模板 `{name}_converted` 与旧行为逐字节一致**：没配过的用户升级后文件名不变
 *   2. 未知占位符按字面量保留，不报错——用户写 `{author}` 不该弹出一个意大利面二审似的报错
 *   3. 渲染结果必须过 `sanitizeFileName`：Windows 不允许 `\ / : * ? " < > |`，
 *      而这些字符完全可能出现在源文件名里
 */
import type { ConflictPolicy, NamingTokens } from './types';

/** 缺省模板：沿用 MVP 的「原名_converted」 */
export const DEFAULT_TEMPLATE = '{name}_converted';

export const NAMING_CONFLICTS: ConflictPolicy[] = ['rename', 'overwrite', 'skip'];

/** 模板里支持的占位符（UI 的提示文案与校验都以这份为准） */
export const NAMING_TOKENS = ['{name}', '{format}', '{date}', '{time}', '{index}', '{preset}'] as const;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** 渲染可能会留 here 的非法字符清干净；空结果由调用方兜底 */
export function sanitizeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : '';
}

/**
 * 渲染模板。
 *
 * `tokens.index` 已经由调用方补零对齐（批量 12 个文件就该是 01…12，而不是 1…12），
 * 这里不做二次处理。
 */
export function renderOutputName(template: string, tokens: NamingTokens): string {
  const map: Record<string, string> = {
    '{name}': tokens.name,
    '{format}': tokens.format,
    '{date}': tokens.date,
    '{time}': tokens.time,
    '{index}': tokens.index,
    '{preset}': tokens.preset,
  };

  const raw = template.replace(/\{[a-zA-Z]+\}/g, (hit) => map[hit] ?? hit);
  return sanitizeFileName(raw);
}

export interface BuildTokensInput {
  sourcePath: string;
  targetLabel: string;
  preset: string;
  /** 批量里的序号（0 起）；单文件时传 null */
  index: number | null;
  /** 整批数量，用于把 {index} 补零成两位数 */
  total: number;
  now?: Date;
}

/** 把「源文件 + 当前设置」变成模板 tokens */
export function buildTokens(input: BuildTokensInput): NamingTokens {
  const base = /([^\\/]+?)(\.[^.\\/]+)?$/.exec(input.sourcePath)?.[1] ?? input.sourcePath;
  const now = input.now ?? new Date();
  const width = input.total >= 100 ? 3 : 2;
  return {
    name: base,
    format: input.targetLabel,
    date: `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}`,
    time: `${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}`,
    index: input.index === null ? '' : pad(input.index + 1, width),
    preset: input.preset,
  };
}
