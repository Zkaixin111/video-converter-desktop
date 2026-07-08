/**
 * 输出轻量校验（对应计划 §7-Q3）。
 *
 * 为什么要有：首页文案承诺「转完自动校验」，如果不做，UI 就是在撒谎。
 * 为什么只做这么点：SSIM / 抽样解码属于 P1-06，MVP 只做容器层能确认的事——
 * 时长对得上、流没丢、文件不是 0 字节。
 *
 * ⚠️ 调用顺序必须是「先 rename 到最终文件，再校验」：
 * 校验的是用户最终拿到的那个文件；顺序反了会出现「文件已删但状态是完成」。
 */
import fs from 'node:fs/promises';
import type { MediaMeta } from '../../../shared/types';
import { probeMedia } from './probe';

export interface VerifyResult {
  ok: boolean;
  detail?: string;
}

/** 容器之间对时长的舍入不同，给 0.2s 容差（计划里定死的口径） */
const DURATION_TOLERANCE_SEC = 0.2;

export async function verifyOutput(srcMeta: MediaMeta, outPath: string): Promise<VerifyResult> {
  let size = 0;
  try {
    const stat = await fs.stat(outPath);
    size = stat.size;
  } catch {
    return { ok: false, detail: '输出文件不存在' };
  }
  if (size <= 0) return { ok: false, detail: '输出文件大小为 0' };

  let out: MediaMeta;
  try {
    out = await probeMedia(outPath);
  } catch (err) {
    return { ok: false, detail: `输出文件无法解析：${(err as Error).message}` };
  }

  if (srcMeta.video && !out.video) {
    return { ok: false, detail: '输出文件里没有视频流' };
  }
  if (srcMeta.audio && !out.audio) {
    return { ok: false, detail: '源文件有声轨，但输出文件没有音轨' };
  }
  if (!srcMeta.audio && out.audio) {
    // 不算失败：某些封装会补一条静音轨
    return { ok: true, detail: '输出包含静音音轨' };
  }

  if (srcMeta.durationSec > 0 && out.durationSec > 0) {
    const delta = Math.abs(out.durationSec - srcMeta.durationSec);
    if (delta > DURATION_TOLERANCE_SEC) {
      return {
        ok: false,
        detail: `时长不一致：源 ${srcMeta.durationSec.toFixed(2)}s，输出 ${out.durationSec.toFixed(2)}s`,
      };
    }
  }

  return { ok: true };
}
