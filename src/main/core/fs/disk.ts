/**
 * 磁盘空间预检。
 *
 * 存在价值就一条：**transfer 前发现空间不够，比转到 80% 失败要好得多**。
 * 批量场景下尤其明显 —— 第 3 个文件写满盘时，前 2 个已经白转了。
 *
 * 查不到可用空间时一律返回 null（老系统 / 权限问题 / 网络盘），
 * 调用方按「不阻挡」处理：预检是加分项，绝不能因为查不出来就让用户转不了。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DiskEstimate } from '../../../shared/types';

/** 目标目录的可用字节数；查不到返回 null */
export function freeBytesAt(dir: string): number | null {
  // statfs 需要 Node 18.15+；Electron 44 自带 Node 22，足够
  const statfs = (fs as unknown as {
    statfsSync?: (p: string, opts?: { bigint: true }) => { bavail: bigint; bsize: bigint };
  }).statfsSync;
  if (typeof statfs !== 'function') return null;

  try {
    // 目录可能还不存在（用户刚选了新位置），退回用它所在的盘
    let probe = path.resolve(dir);
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) return null;
      probe = parent;
    }
    const info = statfs.call(fs, probe, { bigint: true });
    return Number(info.bavail * info.bsize);
  } catch {
    return null;
  }
}

export function checkSpace(targetDir: string, requiredBytes: number): DiskEstimate {
  const free = freeBytesAt(targetDir);
  if (free === null) {
    return { requiredBytes, freeBytes: null, enough: true, shortfallBytes: 0 };
  }
  const shortfall = Math.max(0, requiredBytes - free);
  return { requiredBytes, freeBytes: free, enough: shortfall === 0, shortfallBytes: shortfall };
}
