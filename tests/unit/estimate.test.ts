/**
 * 输出体积估算与空间账（TODO-03）。
 *
 * 核心断言只有两条：
 *   1. 估算必须**偏保守**（宁可高估）：估小了等于没做预检
 *   2. 查不到可用空间时按「充足」处理 —— 预检是加分项，不能因此挡住用户
 */
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_SIZE_FACTOR,
  TIER_SIZE_FACTOR,
  estimateOutputBytes,
  estimateTotalBytes,
  formatBytes,
} from '../../src/shared/estimate';
import type { ContainerKey, ConversionMode } from '../../src/shared/types';

const MB = 1024 * 1024;

describe('estimateOutputBytes · 按模式取估算', () => {
  it('直通按源体积算（直通就是搬运，不是编码）', () => {
    const out = estimateOutputBytes({
      sourceSizeBytes: 100 * MB,
      mode: 'copy',
      target: 'mp4',
    });
    // 允许 2% 的封装开销，但不能缩水
    expect(out).toBeGreaterThanOrEqual(100 * MB);
    expect(out).toBeLessThan(105 * MB);
  });

  it('混合直通（只转音频）体积基本不变', () => {
    const out = estimateOutputBytes({
      sourceSizeBytes: 100 * MB,
      mode: 'remux',
      target: 'mkv',
    });
    expect(out).toBeGreaterThanOrEqual(100 * MB);
    expect(out).toBeLessThan(105 * MB);
  });

  it('重编码按「档位 × 容器 × 1.1」估算，且高估不低估', () => {
    const out = estimateOutputBytes({
      sourceSizeBytes: 100 * MB,
      mode: 'transcode',
      target: 'mp4',
      preset: 'standard',
    });
    // 100 × 0.85 × 1 × 1.1
    expect(out).toBe(Math.round(100 * MB * 0.85 * 1.1));
    expect(out).toBeGreaterThan(100 * MB * 0.85); // 不小于未加余量的估值
  });

  it('体积优先档的估算小于标准档', () => {
    const tier = (preset: 'small' | 'high'): number =>
      estimateOutputBytes({
        sourceSizeBytes: 100 * MB,
        mode: 'transcode',
        target: 'mp4',
        preset,
      });
    expect(tier('small')).toBeLessThan(tier('high'));
  });

  it('老系容器（MPEG）的系数明显高于 MP4', () => {
    const mpeg = estimateOutputBytes({
      sourceSizeBytes: 100 * MB,
      mode: 'transcode',
      target: 'mpeg',
      preset: 'standard',
    });
    const mp4 = estimateOutputBytes({
      sourceSizeBytes: 100 * MB,
      mode: 'transcode',
      target: 'mp4',
      preset: 'standard',
    });
    expect(mpeg).toBeGreaterThan(mp4 * 1.5);
    expect(CONTAINER_SIZE_FACTOR.mpeg).toBeGreaterThan(CONTAINER_SIZE_FACTOR.mp4);
  });

  it('估算值单调：档位越省体积估得越小', () => {
    expect(TIER_SIZE_FACTOR.small).toBeLessThan(TIER_SIZE_FACTOR.standard);
    expect(TIER_SIZE_FACTOR.standard).toBeLessThan(TIER_SIZE_FACTOR.high);
  });
});

describe('estimateTotalBytes · 批量求和', () => {
  it('10 个 100MB 的文件按直通估算约 1GB 出头', () => {
    const items = Array.from({ length: 10 }, () => ({
      sourceSizeBytes: 100 * MB,
      mode: 'copy' as ConversionMode,
      target: 'mp4' as ContainerKey,
    }));
    const total = estimateTotalBytes(items);
    expect(total).toBeGreaterThan(1000 * MB);
    expect(total).toBeLessThan(1100 * MB);
  });

  it('空批次为 0', () => {
    expect(estimateTotalBytes([])).toBe(0);
  });
});

describe('formatBytes', () => {
  it('按量级切换单位', () => {
    expect(formatBytes(512)).toMatch(/KB/);
    expect(formatBytes(500 * MB)).toMatch(/MB/);
    expect(formatBytes(3 * 1024 * MB)).toMatch(/GB/);
  });

  it('0 与负数不出现 -0 之类的怪值', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(-1)).toBe('0 MB');
  });
});
