/**
 * 全组合回归：4 类源文件 × 8 个目标容器，全部真转一遍。
 *
 * 为什么值得跑：判定矩阵是数据驱动的，数据写错时单测只能证明「我按我以为的规则走」，
 * 只有真转一遍、再用 ffprobe 读回来，才能证明「规则和 ffmpeg 的真实能力一致」。
 *
 * 跑法：npx vitest run tests/regression
 * 产物：docs/regression-report.md（每次覆盖，方便贴进交付说明）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { CONTAINERS, CONTAINER_ORDER } from '../../src/shared/containers';
import type { ContainerKey } from '../../src/shared/types';
import { planConversion } from '../../src/main/core/ffmpeg/planner';
import { runConversion } from '../../src/main/core/ffmpeg/runner';
import { probeMedia } from '../../src/main/core/ffmpeg/probe';
import { verifyOutput } from '../../src/main/core/ffmpeg/verify';
import { partPathFor } from '../../src/main/core/fs/temp';
import {
  BINARIES_AVAILABLE,
  FIXTURES_AVAILABLE,
  TMP,
  cleanupTmp,
  ensureTmp,
  fixture,
} from '../integration/helpers';

const d = BINARIES_AVAILABLE && FIXTURES_AVAILABLE ? describe : describe.skip;

interface Source {
  file: string;
  label: string;
}

const SOURCES: Source[] = [
  { file: 'sample-h264-aac.mp4', label: 'H.264 + AAC / MP4' },
  { file: 'sample-h264-ac3.mkv', label: 'H.264 + AC3 / MKV' },
  { file: 'sample-mpeg4-mp3.avi', label: 'MPEG-4 + MP3 / AVI' },
  { file: 'sample-noaudio.mp4', label: 'H.264 / 无音轨 MP4' },
];

interface Row {
  source: string;
  target: string;
  mode: string;
  ok: boolean;
  outCodec: string;
  outAudio: string;
  sizeKb: number;
  ms: number;
  note: string;
}

const rows: Row[] = [];

afterAll(() => {
  if (rows.length === 0) return;
  const lines = [
    '# 转换矩阵回归报告',
    '',
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    `组合数：${rows.length}（4 类源文件 × 8 个目标容器）`,
    '',
    '| 源文件 | 目标 | 判定模式 | 结果 | 输出视频编码 | 输出音频编码 | 体积 | 耗时 |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.source} | ${r.target} | ${r.mode} | ${r.ok ? '✅' : `❌ ${r.note}`} | ${r.outCodec} | ${r.outAudio} | ${r.sizeKb.toFixed(0)} KB | ${r.ms} ms |`,
    ),
    '',
    `通过 ${rows.filter((r) => r.ok).length} / ${rows.length}`,
  ];

  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/regression-report.md');
  fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
  cleanupTmp();
});

d('4 × 8 全组合真实转换', () => {
  for (const src of SOURCES) {
    for (const target of CONTAINER_ORDER) {
      it(`${src.label} → ${CONTAINERS[target].label}`, async () => {
        ensureTmp();
        const input = fixture(src.file);
        const meta = await probeMedia(input);
        const plan = planConversion({ meta, target: target as ContainerKey });

        const outPath = path.join(
          TMP,
          `reg-${src.file.replace(/\.[^.]+$/, '')}-${target}${CONTAINERS[target].ext}`,
        );
        const started = Date.now();

        let ok = true;
        let note = '';
        let outCodec = '—';
        let outAudio = '—';
        let sizeKb = 0;

        try {
          await runConversion({
            inputPath: input,
            outputPartPath: partPathFor(outPath),
            args: plan.args,
            totalDurationSec: meta.durationSec,
          }).promise;
          fs.renameSync(partPathFor(outPath), outPath);

          const verified = await verifyOutput(meta, outPath);
          if (!verified.ok) {
            ok = false;
            note = verified.detail ?? '校验未通过';
          }

          const back = await probeMedia(outPath);
          outCodec = back.video?.codec ?? '无';
          outAudio = back.audio?.codec ?? '无音轨';
          sizeKb = fs.statSync(outPath).size / 1024;
        } catch (err) {
          ok = false;
          note = (err as Error).message.slice(0, 120);
        }

        rows.push({
          source: src.label,
          target: CONTAINERS[target].label,
          mode: plan.mode,
          ok,
          outCodec,
          outAudio,
          sizeKb,
          ms: Date.now() - started,
          note,
        });

        expect(ok, `${src.label} → ${target}: ${note}`).toBe(true);
      });
    }
  }
});
