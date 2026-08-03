/**
 * 输出体积估算（纯函数，用于磁盘空间预检）。
 *
 * 精度取舍：**宁可高估，不可低估**。
 * 预检的目的是拦住「转到一半磁盘写满，整批全废」，估小了等于没做；
 * 估大了最多是让用户多清理一点空间。所有系数取自己 32 组合回归的实测比值
 * （见 docs/regression-report.md），不是拍脑袋——矩阵变了应当重跑回归校一遍。
 */
import type { ContainerKey, ConversionMode, PresetTier } from './types';

/**
 * 各容器相对「同等画质 x264/MP4」的体积系数。
 * 老系编码器（mpeg2、wmv2）效率差得多，不带上它会严重低估 MPEG/WMV 的输出。
 */
export const CONTAINER_SIZE_FACTOR: Record<ContainerKey, number> = {
  mp4: 1,
  mkv: 1,
  mov: 1,
  flv: 1.1,
  avi: 1.4,
  wmv: 1.6,
  webm: 0.75,
  mpeg: 1.8,
};

/** 档位对体积的影响（与 containers.ts 的码率系数同源）；直通时不参与 */
export const TIER_SIZE_FACTOR: Record<PresetTier, number> = {
  high: 1.15,
  standard: 0.85,
  small: 0.45,
};

/** 混合直通（只重编码音频）只动音轨，体积基本不变 */
const REMUX_SIZE_FACTOR = 1.02;
/** 直通是封装搬运，体积等于源文件（多算 2% 给封装开销） */
const COPY_SIZE_FACTOR = 1.02;

export interface EstimateInput {
  sourceSizeBytes: number;
  mode: ConversionMode;
  target: ContainerKey;
  preset?: PresetTier;
}

/**
 * 估算单个任务的输出体积（字节）。
 *
 * 直通按源体积算：这正是「无损直通」的定义，不需要知道编码参数。
 */
export function estimateOutputBytes(input: EstimateInput): number {
  const source = Math.max(0, input.sourceSizeBytes);
  if (input.mode === 'copy') return Math.round(source * COPY_SIZE_FACTOR);
  if (input.mode === 'remux') return Math.round(source * REMUX_SIZE_FACTOR);

  const tier = TIER_SIZE_FACTOR[input.preset ?? 'standard'];
  const container = CONTAINER_SIZE_FACTOR[input.target] ?? 1;
  // 高估 10%：CRF 模式下的实际码率会随画面复杂度浮动
  return Math.round(source * tier * container * 1.1);
}

/** 批量时把整批的预估加起来 —— 队列是顺序执行的，空间要按「全部写完」算 */
export function estimateTotalBytes(items: EstimateInput[]): number {
  return items.reduce((sum, item) => sum + estimateOutputBytes(item), 0);
}

/** 字节数 → 给人看的 GB/MB 文案 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
