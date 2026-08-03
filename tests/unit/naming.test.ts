/**
 * 输出命名模板与重名策略（TODO-02）。
 *
 * 两条底线：
 *   1. **默认配置产出的文件名必须与 MVP 逐字节一致**（老用户不该发现文件名变了）
 *   2. 「直接覆盖」永远不能覆盖源文件本身 —— 那会把用户的原片弄没
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { DEFAULT_TEMPLATE, buildTokens, renderOutputName, sanitizeFileName } from '../../src/shared/outputName';
import { resolveOutputPath } from '../../src/main/core/fs/outputPath';
import type { NamingTokens } from '../../src/shared/types';

const WIN_DIR = 'C:\\Users\\me\\Videos';
const SRC = path.join(WIN_DIR, 'clip.mp4');

function tokens(extra: Partial<NamingTokens> = {}): NamingTokens {
  return {
    name: 'clip',
    format: 'MP4',
    date: '20261018',
    time: '0930',
    index: '03',
    preset: 'standard',
    ...extra,
  };
}

describe('renderOutputName', () => {
  it('默认模板产出 xxx_converted（与 MVP 一致）', () => {
    expect(renderOutputName(DEFAULT_TEMPLATE, tokens())).toBe('clip_converted');
  });

  it('多占位符一次渲染', () => {
    expect(renderOutputName('{name}_{format}_{date}', tokens())).toBe('clip_MP4_20261018');
  });

  it('未知占位符按字面量保留，不报错', () => {
    expect(renderOutputName('{name}_{author}', tokens())).toBe('clip_{author}');
  });

  it('Windows 非法字符被清掉', () => {
    expect(sanitizeFileName('a/b:c*d?e"f<g>h|i')).toBe('abcdefghi');
    expect(renderOutputName('{name}_1', tokens({ name: 're:take' }))).toBe('retake_1');
  });

  it('模板渲染为空时由调用方回落（sanitize 返回空串）', () => {
    expect(sanitizeFileName('///')).toBe('');
  });
});

describe('buildTokens', () => {
  it('去掉扩展名、补零序号、日期时间按本地时区格式', () => {
    const t = buildTokens({
      sourcePath: 'C:\\v\\my.movie.mp4',
      targetLabel: 'MKV',
      preset: 'high',
      index: 2,
      total: 12,
      now: new Date(2026, 9, 18, 9, 30),
    });
    expect(t.name).toBe('my.movie');
    expect(t.format).toBe('MKV');
    expect(t.index).toBe('03'); // 0 起的序号 → 第 3 个，两位数
    expect(t.date).toBe('20261018');
    expect(t.time).toBe('0930');
    expect(t.preset).toBe('high');
  });

  it('100 个以上时序号补三位，避免 10 排在 2 前面', () => {
    const t = buildTokens({
      sourcePath: 'a.mp4',
      targetLabel: 'MP4',
      preset: 'standard',
      index: 4,
      total: 120,
      now: new Date(2026, 0, 1, 0, 0),
    });
    expect(t.index).toBe('005');
  });
});

describe('resolveOutputPath · 默认行为不变', () => {
  it('无冲突时就是 <原名>_converted<扩展名>', () => {
    const out = resolveOutputPath(SRC, 'mp4', { exists: () => false });
    expect(path.basename(out)).toBe('clip_converted.mp4');
    expect(path.dirname(out)).toBe(WIN_DIR);
  });

  it('重名时自动加序号（默认 rename）', () => {
    const existing = new Set([path.join(WIN_DIR, 'clip_converted.mp4')]);
    const out = resolveOutputPath(SRC, 'mp4', { exists: (p) => existing.has(p) });
    expect(path.basename(out)).toBe('clip_converted_1.mp4');
  });

  it('指定了输出目录时用该目录', () => {
    const out = resolveOutputPath(SRC, 'mkv', { outputDir: 'D:\\out', exists: () => false });
    expect(out).toBe(path.join('D:\\out', 'clip_converted.mkv'));
  });
});

describe('resolveOutputPath · 自定义模板', () => {
  it('模板里的 {index} 用于批量序号', () => {
    const out = resolveOutputPath(SRC, 'mp4', {
      exists: () => false,
      template: '{name}_{index}',
      index: 2,
      total: 12,
    });
    expect(path.basename(out)).toBe('clip_03.mp4');
  });

  it('模板渲染为空时回落到默认模板', () => {
    const out = resolveOutputPath(SRC, 'mp4', { exists: () => false, template: '///' });
    expect(path.basename(out)).toBe('clip_converted.mp4');
  });

  it('模板与源文件同名时退一步加 _converted，绝不覆盖源文件', () => {
    // 模板刚好渲染出源文件主名 + 同扩展名
    const out = resolveOutputPath(SRC, 'mp4', {
      exists: () => false,
      template: '{name}',
    });
    expect(path.basename(out)).toBe('clip_converted.mp4');
  });
});

describe('resolveOutputPath · 重名策略', () => {
  it('overwrite：存在同名文件时照原样返回', () => {
    const out = resolveOutputPath(SRC, 'mp4', {
      exists: () => true,
      conflict: 'overwrite',
    });
    expect(path.basename(out)).toBe('clip_converted.mp4');
  });

  it('skip：存在同名文件时抛 E_OUTPUT_SKIPPED', () => {
    try {
      resolveOutputPath(SRC, 'mp4', { exists: () => true, conflict: 'skip' });
      expect.unreachable('应当抛错');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('E_OUTPUT_SKIPPED');
    }
  });

  it('skip：没有冲突时正常返回路径', () => {
    const out = resolveOutputPath(SRC, 'mp4', { exists: () => false, conflict: 'skip' });
    expect(path.basename(out)).toBe('clip_converted.mp4');
  });
});
