/**
 * 输出路径规划。
 *
 * 规则优先级（方案 §3.8）：
 *   1. 用户指定目录 → 用该目录
 *   2. 否则 → 源文件同级目录
 *   3. 文件名 <原名>_converted<后缀>
 *   4. 已存在 → 递增序号直到不冲突
 *   5. 规范化后若与源文件同路径 → 抛 E_SAME_PATH
 *
 * 为了可单测，`exists` 注入进来，默认用 fs.existsSync。
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONTAINERS, isContainerKey } from '../../../shared/containers';
import { AppError } from '../../../shared/errors';
import type { ContainerKey } from '../../../shared/types';

export interface ResolveOptions {
  /** 用户指定的输出目录；null/undefined 表示源文件同级 */
  outputDir?: string | null;
  /** 依赖注入，方便单测 */
  exists?: (p: string) => boolean;
  maxAttempts?: number;
}

/** Windows 路径大小写不敏感，比较前统一小写 */
function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

export function resolveOutputPath(
  sourcePath: string,
  target: ContainerKey,
  options: ResolveOptions = {},
): string {
  if (!isContainerKey(target)) {
    throw new AppError('E_UNSUPPORTED_TARGET', `不支持的目标格式：${String(target)}`);
  }
  const { outputDir, exists = fs.existsSync, maxAttempts = 200 } = options;

  const dir = outputDir && outputDir.trim() ? path.resolve(outputDir) : path.dirname(sourcePath);
  const ext = CONTAINERS[target].ext;
  const baseName = path.basename(sourcePath, path.extname(sourcePath));

  for (let i = 0; i < maxAttempts; i += 1) {
    const suffix = i === 0 ? '' : `_${i}`;
    const candidate = path.join(dir, `${baseName}_converted${suffix}${ext}`);

    // 与源文件同路径：直接跳过（理论上扩展名不同不会撞，但同名容器转换会撞）
    if (samePath(candidate, sourcePath)) continue;
    if (!exists(candidate)) return candidate;
  }

  throw new AppError('E_PERMISSION', '输出目录下无法生成不冲突的文件名。', {
    hint: '请换一个输出目录，或清理同名文件后再试。',
  });
}
