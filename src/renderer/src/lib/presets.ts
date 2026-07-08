/**
 * 参数预设页的静态数据（取自 UI 原型，数值一字未改）。
 *
 * ⚠️ 本页配置**不参与转换**：MVP 的质量档位只在 UI 上持久化，
 * 真正的 CRF / 码率选择在 P1 接入 planner。页面上已用灰色提示条如实说明。
 */
import type { ContainerKey, PresetTier } from '../../../shared/types';

export const PRESET_DESC: Record<ContainerKey, string> = {
  mp4: '通用兼容 · 几乎所有设备都能播放',
  mkv: '无损封装 · 适合保留多音轨与字幕',
  avi: '老设备 · 老旧播放器与车载屏幕',
  mov: '苹果生态 · 苹果设备与剪辑软件',
  flv: '网页旧版 · 老式网页与直播回放',
  wmv: 'Windows · Windows 老版本播放器',
  webm: '网页压缩 · 网页嵌入，体积小',
  mpeg: '老旧播放 · 老式 DVD 与电视',
};

export const TIERS: { key: PresetTier; name: string; desc: string }[] = [
  { key: 'high', name: '高清优先', desc: '画质最好' },
  { key: 'standard', name: '标准', desc: '画质与体积平衡' },
  { key: 'small', name: '体积优先', desc: '文件最小' },
];

/** 体积倍率（相对原始大小）。每档略作区分，避免看起来是同一套数字。 */
export const MULT_TABLE: Record<ContainerKey, Record<PresetTier, string>> = {
  mp4: { high: '1.2×', standard: '0.7×', small: '0.4×' },
  mkv: { high: '1.0×', standard: '0.8×', small: '0.55×' },
  avi: { high: '1.1×', standard: '0.65×', small: '0.35×' },
  mov: { high: '1.15×', standard: '0.7×', small: '0.4×' },
  flv: { high: '1.0×', standard: '0.6×', small: '0.35×' },
  wmv: { high: '1.0×', standard: '0.6×', small: '0.35×' },
  webm: { high: '0.9×', standard: '0.5×', small: '0.3×' },
  mpeg: { high: '1.2×', standard: '0.8×', small: '0.5×' },
};
