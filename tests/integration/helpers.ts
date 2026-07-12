/**
 * 集成测试的公共设施。
 *
 * 核心原则：**没跑就明说没跑**。
 * 找不到 ffmpeg 时直接 skip，并往控制台打一条醒目的警告，
 * 绝不让「环境没配好」变成「测试通过」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFfmpegPath, getFfprobePath } from '../../src/main/core/ffmpeg/paths';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURES = path.resolve(HERE, '..', 'fixtures');
export const TMP = path.resolve(HERE, '..', '.tmp');

export const ffmpegPath = getFfmpegPath();
export const ffprobePath = getFfprobePath();

export const BINARIES_AVAILABLE = fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath);

if (!BINARIES_AVAILABLE) {
  const bar = '='.repeat(78);
  console.warn(
    [
      '',
      bar,
      '⚠️  集成测试被跳过：没有找到 ffmpeg / ffprobe',
      `   期望位置：${ffmpegPath}`,
      `            ${ffprobePath}`,
      '   这不是「测试通过」，是「没测」。装好二进制后重跑 pnpm test:int',
      bar,
      '',
    ].join('\n'),
  );
}

/** fixture 不存在时也跳过（fixture 是脚本生成的，不进版本库） */
export const FIXTURES_AVAILABLE =
  BINARIES_AVAILABLE && fs.existsSync(path.join(FIXTURES, 'sample-h264-aac.mp4'));

if (BINARIES_AVAILABLE && !FIXTURES_AVAILABLE) {
  console.warn('\n⚠️  集成测试被跳过：fixture 缺失，请先运行 `pnpm fixtures`\n');
}

export function fixture(name: string): string {
  return path.join(FIXTURES, name);
}

export function ensureTmp(): void {
  fs.mkdirSync(TMP, { recursive: true });
}

export function tmpFile(name: string): string {
  ensureTmp();
  return path.join(TMP, name);
}

/**
 * 清理临时目录。
 *
 * 清理属于「收尾」而不是「断言」，失败不该让整个测试文件变红：
 * Windows 上刚 spawn 过的 ffmpeg 可能还短暂持有句柄，某些环境还会给
 * 递归删除加上确认策略。这种情况只提示残留目录，用例结果照常判定。
 */
export function cleanupTmp(): void {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (err) {
    console.warn(`⚠️  临时目录未能清理干净（不影响用例结果）：${TMP}\n   ${String(err)}`);
  }
}

export function fileSize(p: string): number {
  return fs.statSync(p).size;
}
