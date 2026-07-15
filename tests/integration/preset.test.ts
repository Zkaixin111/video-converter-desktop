/**
 * 画质档位的端到端验证（P1-03）。
 *
 * 单测只能证明「参数拼对了」，证明不了「参数真的起作用」。
 * 这里用同一个源文件分别按 high / small 真转一遍，比较产物体积：
 * 如果档位没接进命令，两次输出会一模一样。
 *
 * 同时守住一条兼容性契约：不传档位时必须等价于 standard。
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { planConversion } from '../../src/main/core/ffmpeg/planner';
import { probeMedia } from '../../src/main/core/ffmpeg/probe';
import { runConversion } from '../../src/main/core/ffmpeg/runner';
import { partPathFor } from '../../src/main/core/fs/temp';
import type { ContainerKey, PresetTier } from '../../src/shared/types';
import {
  BINARIES_AVAILABLE,
  FIXTURES_AVAILABLE,
  cleanupTmp,
  fileSize,
  fixture,
  tmpFile,
} from './helpers';

const d = BINARIES_AVAILABLE && FIXTURES_AVAILABLE ? describe : describe.skip;

afterAll(() => cleanupTmp());

/** 转一次，返回输出文件大小（字节） */
async function convertOnce(
  source: string,
  target: ContainerKey,
  preset: PresetTier | undefined,
  tag: string,
): Promise<{ size: number; out: string }> {
  const meta = await probeMedia(source);
  const plan = planConversion({ meta, target, options: { preset } });
  const out = tmpFile(`preset-${tag}.webm`);
  const part = partPathFor(out);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const handle = runConversion({
    inputPath: source,
    outputPartPath: part,
    args: plan.args,
    totalDurationSec: meta.durationSec,
  });
  await handle.promise;
  fs.renameSync(part, out);
  return { size: fileSize(out), out };
}

d('画质档位 → 真实编码产物', () => {
  it('small 的产物明显小于 high（说明档位真的进了命令）', async () => {
    const src = fixture('sample-h264-aac.mp4');
    const high = await convertOnce(src, 'webm', 'high', 'high');
    const small = await convertOnce(src, 'webm', 'small', 'small');

    expect(high.size).toBeGreaterThan(0);
    expect(small.size).toBeGreaterThan(0);
    // VP9 在 2 秒短片上的差距不大，留 10% 余量即可判定「确实不同」
    expect(small.size).toBeLessThan(high.size * 0.9);
  }, 120_000);

  it('不传档位与显式 standard 产出完全一致（兼容性契约）', async () => {
    const src = fixture('sample-h264-aac.mp4');
    const implicit = await convertOnce(src, 'webm', undefined, 'implicit');
    const explicit = await convertOnce(src, 'webm', 'standard', 'explicit');
    // 同一命令、同一编码器，体积应逐字节相同
    expect(implicit.size).toBe(explicit.size);
  }, 120_000);
});
