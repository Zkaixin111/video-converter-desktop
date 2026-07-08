/**
 * `.part` 临时文件管理。
 *
 * 为什么要用 .part：ffmpeg 直接写最终文件时，中途失败/取消会留下一个
 * 「看起来正常、实际不完整」的文件，用户双击打不开却不知道原因。
 * 先写 .part、成功再 rename，保证目标目录里出现的永远是完整文件。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * `.part` 临时文件路径。
 *
 * ⚠️ 必须是 `名字.part.扩展名`，而不是 `名字.扩展名.part`：
 * ffmpeg 靠**最后一段扩展名**推断输出封装器，写成 `clip.mkv.part` 它会直接报
 * 「Unable to find a suitable output format for 'clip.mkv.part'」，
 * 每一次转换都会失败。反过来 `clip.part.mkv` 既能被正确识别，用户也能一眼看出是临时文件。
 *
 * 与最终文件同目录，保证 rename 是原子操作（跨盘 rename 会退化成复制）。
 */
export function partPathFor(outputPath: string): string {
  const dir = path.dirname(outputPath);
  const ext = path.extname(outputPath);
  const base = path.basename(outputPath, ext);
  return path.join(dir, `${base}.part${ext}`);
}

/**
 * 尽力删除 .part。
 *
 * 二次延迟清理的原因：Windows 上 ffmpeg 被 taskkill 后，
 * 文件句柄可能还没释放，立刻 unlink 会 EBUSY。
 */
export async function cleanupPart(partPath: string, delayMs = 500): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.unlink(partPath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      if (attempt === 2) return; // 交给系统临时目录清理，不阻断主流程
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
