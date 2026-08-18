/**
 * 输出路径规划。
 *
 * 规则优先级（方案 §3.8）：
 *   1. 用户指定目录 → 用该目录
 *   2. 否则 → 源文件同级目录
 *   3. 文件名由**命名模板**渲染（默认 `{name}_converted`，即 MVP 行为）
 *   4. 重名时按冲突策略处理：自动加序号 / 直接覆盖 / 跳过该文件
 *   5. 规范化后若与源文件同路径 → 退一步加 `_converted` 再走一遍策略
 *   6. 模板渲染结果为空（用户写了个只有非法字符的模板）→ 回落到默认模板
 *
 * 为了可单测，`exists` 注入进来，默认用 fs.existsSync。
 */
import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_FORMATS, isAudioFormat } from '../../../shared/audio';
import { CONTAINERS, isContainerKey } from '../../../shared/containers';
import { AppError } from '../../../shared/errors';
import { DEFAULT_TEMPLATE, buildTokens, renderOutputName } from '../../../shared/outputName';
import type {
  AudioFormat,
  ConflictPolicy,
  ContainerKey,
  NamingTokens,
  PresetTier,
} from '../../../shared/types';

export interface ResolveOptions {
  /** 用户指定的输出目录；null/undefined 表示源文件同级 */
  outputDir?: string | null;
  /** 依赖注入，方便单测 */
  exists?: (p: string) => boolean;
  maxAttempts?: number;
  /** 命名模板；缺省 `{name}_converted` */
  template?: string | null;
  /** 重名策略；缺省 `rename`（自动加序号） */
  conflict?: ConflictPolicy;
  /**
   * `{index}` / `{preset}` 需要的上下文。
   * 不传时 `{index}` 渲染为空串、`{preset}` 用传入的档位——单文件调用方不必关心批量序号。
   */
  tokens?: Partial<NamingTokens> | null;
  /** 批量序号（0 起）与整批数量：决定 `{index}` 的值与补零位数 */
  index?: number | null;
  total?: number;
  preset?: PresetTier;
  /** 渲染模板用的「当前时间」，测试里固定住它 */
  now?: Date;
}

/** Windows 路径大小写不敏感，比较前统一小写 */
function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/** 在扩展名之前插入后缀：`a.mp4` → `a_1.mp4` */
function withSuffix(filePath: string, suffix: string): string {
  const ext = path.extname(filePath);
  const stem = filePath.slice(0, filePath.length - ext.length);
  return `${stem}${suffix}${ext}`;
}

export function resolveOutputPath(
  sourcePath: string,
  target: ContainerKey,
  options: ResolveOptions = {},
): string {
  if (!isContainerKey(target)) {
    throw new AppError('E_UNSUPPORTED_TARGET', `不支持的目标格式：${String(target)}`);
  }
  return buildOutputPath(sourcePath, CONTAINERS[target].ext, CONTAINERS[target].label, options);
}

/**
 * 音频提取的输出路径（TODO-20）。
 *
 * 与视频同一套规则（模板 / 重名策略 / 防覆盖源文件），只是扩展名与
 * `{format}` 的取值换成音频格式 —— 用户在设置里配的命名模板应当同样生效。
 */
export function resolveAudioPath(
  sourcePath: string,
  format: AudioFormat,
  options: ResolveOptions = {},
): string {
  if (!isAudioFormat(format)) {
    throw new AppError('E_UNSUPPORTED_TARGET', `不支持的音频格式：${String(format)}`);
  }
  return buildOutputPath(
    sourcePath,
    AUDIO_FORMATS[format].ext,
    AUDIO_FORMATS[format].label,
    options,
  );
}

function buildOutputPath(
  sourcePath: string,
  ext: string,
  targetLabel: string,
  options: ResolveOptions,
): string {
  const {
    outputDir,
    exists = fs.existsSync,
    maxAttempts = 200,
    template,
    conflict = 'rename',
    tokens = null,
    index = null,
    total = 1,
    preset = 'standard',
    now,
  } = options;

  const dir = outputDir && outputDir.trim() ? path.resolve(outputDir) : path.dirname(sourcePath);

  // 模板 → 文件名。渲染结果为空（模板全是非法字符）时回落到默认模板，
  // 否则会写出一个「没有名字点mp4」的文件。
  const built = buildTokens({
    sourcePath,
    targetLabel,
    preset,
    index,
    total,
    now,
  });
  const merged: NamingTokens = { ...built, ...(tokens ?? {}) };
  const tpl = template && template.trim() ? template : DEFAULT_TEMPLATE;
  let baseName = renderOutputName(tpl, merged);
  if (!baseName) baseName = renderOutputName(DEFAULT_TEMPLATE, merged);

  const first = path.join(dir, `${baseName}${ext}`);
  // 与源文件同路径：直接覆盖源文件是灾难，退一步加后缀
  const start = samePath(first, sourcePath) ? withSuffix(first, '_converted') : first;

  if (conflict === 'overwrite') return start;

  if (conflict === 'skip') {
    if (exists(start)) throw new AppError('E_OUTPUT_SKIPPED', '同名输出文件已存在，按设置跳过该文件。');
    return start;
  }

  // rename：已存在就加序号，直到不冲突
  let candidate = start;
  for (let i = 1; i <= maxAttempts; i += 1) {
    if (!exists(candidate)) return candidate;
    candidate = withSuffix(start, `_${i}`);
  }

  throw new AppError('E_PERMISSION', '输出目录下无法生成不冲突的文件名。', {
    hint: '请换一个输出目录，或清理同名文件后再试。',
  });
}
