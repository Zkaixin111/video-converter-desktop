/**
 * 输出路径规划测试。
 *
 * 规则简单，但每一条都对应一个真实的翻车场景：
 *   · 不重名        → 用户点了两次转换，第二次把第一次的结果覆盖掉
 *   · 不与源同路径  → mkv 转 mkv，输出把源文件顶掉（直接毁原片）
 *   · 指定目录      → 用户改了输出目录却还是写回源目录
 */
import { describe, expect, it } from 'vitest';
import { resolveOutputPath } from '../../src/main/core/fs/outputPath';
import { AppError } from '../../src/shared/errors';

const exists = (set: string[]) => (p: string) =>
  set.some((s) => s.toLowerCase() === p.toLowerCase());

describe('resolveOutputPath · 基本命名', () => {
  it('默认输出到源文件同级，文件名加 _converted 与目标扩展名', () => {
    const out = resolveOutputPath('C:\\videos\\clip.mkv', 'mp4', { exists: () => false });
    expect(out).toBe('C:\\videos\\clip_converted.mp4');
  });

  it('目标扩展名跟着容器矩阵走（mpeg → .mpg）', () => {
    const out = resolveOutputPath('D:\\a\\b.mp4', 'mpeg', { exists: () => false });
    expect(out.endsWith('.mpg')).toBe(true);
  });

  it('保留源文件的多个点（a.b.c.mp4 → a.b.c_converted.mkv）', () => {
    const out = resolveOutputPath('C:\\v\\a.b.c.mp4', 'mkv', { exists: () => false });
    expect(out).toBe('C:\\v\\a.b.c_converted.mkv');
  });

  it('指定输出目录时用该目录', () => {
    const out = resolveOutputPath('C:\\videos\\clip.mkv', 'mp4', {
      outputDir: 'D:\\out',
      exists: () => false,
    });
    expect(out).toBe('D:\\out\\clip_converted.mp4');
  });

  it('outputDir 为空字符串等同「未指定」', () => {
    const out = resolveOutputPath('C:\\videos\\clip.mkv', 'mp4', {
      outputDir: '   ',
      exists: () => false,
    });
    expect(out).toBe('C:\\videos\\clip_converted.mp4');
  });
});

describe('resolveOutputPath · 重名避让', () => {
  it('已存在时递增序号', () => {
    const taken = exists(['C:\\v\\clip_converted.mp4']);
    expect(resolveOutputPath('C:\\v\\clip.mkv', 'mp4', { exists: taken })).toBe(
      'C:\\v\\clip_converted_1.mp4',
    );
  });

  it('连续占用时一路递增到第一个空位', () => {
    const taken = exists([
      'C:\\v\\clip_converted.mp4',
      'C:\\v\\clip_converted_1.mp4',
      'C:\\v\\clip_converted_2.mp4',
    ]);
    expect(resolveOutputPath('C:\\v\\clip.mkv', 'mp4', { exists: taken })).toBe(
      'C:\\v\\clip_converted_3.mp4',
    );
  });

  it('重名比较大小写不敏感（Windows 文件系统语义）', () => {
    const taken = exists(['c:\\v\\clip_converted.mp4']);
    expect(resolveOutputPath('C:\\v\\clip.mkv', 'mp4', { exists: taken })).toBe(
      'C:\\v\\clip_converted_1.mp4',
    );
  });

  it('尝试次数用尽 → E_PERMISSION（而不是死循环）', () => {
    try {
      resolveOutputPath('C:\\v\\clip.mkv', 'mp4', { exists: () => true, maxAttempts: 3 });
      throw new Error('应当抛错');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('E_PERMISSION');
    }
  });
});

describe('resolveOutputPath · 与源文件撞车', () => {
  it('mkv 转 mkv：同目录下必然生成不同文件名，绝不覆盖源文件', () => {
    const src = 'C:\\v\\clip.mkv';
    const out = resolveOutputPath(src, 'mkv', { exists: () => false });
    expect(out.toLowerCase()).not.toBe(src.toLowerCase());
    expect(out).toBe('C:\\v\\clip_converted.mkv');
  });

  it('源文件本身就叫 xxx_converted.mp4 时也不会自我覆盖', () => {
    const src = 'C:\\v\\clip_converted.mp4';
    const out = resolveOutputPath(src, 'mp4', { exists: () => false });
    expect(out.toLowerCase()).not.toBe(src.toLowerCase());
    expect(out).toBe('C:\\v\\clip_converted_converted.mp4');
  });
});

describe('resolveOutputPath · 入参校验', () => {
  it('非法目标格式 → E_UNSUPPORTED_TARGET', () => {
    try {
      resolveOutputPath('C:\\v\\a.mp4', '3gp' as never, { exists: () => false });
      throw new Error('应当抛错');
    } catch (err) {
      expect((err as AppError).code).toBe('E_UNSUPPORTED_TARGET');
    }
  });
});
