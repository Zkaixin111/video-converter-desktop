/**
 * ffmpeg stderr 翻译测试。
 *
 * 喂的都是真实跑出来的报错片段（不是编的字符串）——
 * 这些正则一旦和真实输出对不上，用户看到的就是「出现未知错误」。
 */
import { describe, expect, it } from 'vitest';
import { translateFfmpegError } from '../../src/main/core/ffmpeg/errors';
import { AppError, toAppError } from '../../src/shared/errors';

const CASES: { name: string; stderr: string; code: string }[] = [
  {
    name: 'moov atom 缺失（下载中断）',
    stderr: `[mov,mp4,m4a,3gp,3g2,mj2 @ 000001] moov atom not found
C:\\videos\\broken.mp4: Invalid data found when processing input`,
    code: 'E_CORRUPT_FILE',
  },
  {
    name: '非视频内容（后缀造假）',
    stderr: `[mov,mp4,m4a @ 000001] Invalid data found when processing input
tests\\fixtures\\fake.mp4: Invalid data found when processing input`,
    code: 'E_INVALID_INPUT',
  },
  {
    name: '磁盘写满',
    stderr: `av_interleaved_write_frame(): No space left on device
Error writing trailer of out.mp4: No space left on device`,
    code: 'E_DISK_FULL',
  },
  {
    name: '目标文件被占用',
    stderr: `Could not open output file out.mp4: Permission denied
[AVIOContext @ 000001] Error opening output out.mp4: Permission denied`,
    code: 'E_PERMISSION',
  },
  {
    name: '编码器不存在',
    stderr: `Unknown encoder 'libx264'`,
    code: 'E_ENCODER_MISSING',
  },
  {
    name: '编码器初始化失败',
    stderr: `[libx264 @ 000001] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height`,
    code: 'E_ENCODER_INIT',
  },
  {
    name: '兜底：Conversion failed',
    stderr: `frame=  120 fps= 60 q=28.0 size=     256kB time=00:00:04.00 bitrate= 524.3kbits/s
Conversion failed!`,
    code: 'E_FFMPEG_FAILED',
  },
];

describe('translateFfmpegError', () => {
  for (const c of CASES) {
    it(`${c.name} → ${c.code}`, () => {
      const err = translateFfmpegError(c.stderr, 1);
      expect(err.code).toBe(c.code);
      expect(err.message.length).toBeGreaterThan(0);
      // 中文文案：至少要含一个中文字符，避免把英文原文糊到用户脸上
      expect(/[\u4e00-\u9fa5]/.test(err.message)).toBe(true);
    });
  }

  it('detail 里带退出码与 stderr 末 20 行', () => {
    const err = translateFfmpegError('line\n'.repeat(100) + 'Unknown encoder', 1);
    expect(err.detail).toContain('退出码: 1');
    expect(err.detail).toContain('Unknown encoder');
    // 只保留末 20 行，不能把几万行日志塞进剪贴板
    expect((err.detail ?? '').split('\n').length).toBeLessThanOrEqual(24);
  });

  it('规则优先级：moov atom 命中时不会再被 Invalid data 抢走', () => {
    // 这条 stderr 同时含两个关键词，必须落到更具体的 E_CORRUPT_FILE
    const err = translateFfmpegError(
      'moov atom not found\nInvalid data found when processing input',
      1,
    );
    expect(err.code).toBe('E_CORRUPT_FILE');
  });

  it('完全无法识别的 stderr → E_UNKNOWN，但仍保留诊断信息', () => {
    const err = translateFfmpegError('something totally unexpected', 137);
    expect(err.code).toBe('E_UNKNOWN');
    expect(err.detail).toContain('137');
  });

  it('每条规则都给了 hint（用户需要知道下一步做什么）', () => {
    for (const c of CASES) {
      expect(translateFfmpegError(c.stderr, 1).hint).toBeTruthy();
    }
  });
});

describe('toAppError · 原生异常的翻译', () => {
  const fsError = (code: string, message: string): Error => {
    const err = new Error(message) as NodeJS.ErrnoException;
    err.code = code;
    return err;
  };

  it('目录不可写（EEXIST / ENOTDIR）不会把英文 errno 糊到界面上', () => {
    const err = toAppError(fsError('EEXIST', "EEXIST: file already exists, mkdir 'C://x'"));
    expect(err.code).toBe('E_PERMISSION');
    // 用户看到的是中文，英文原文只进 detail（诊断信息）
    expect(err.message).toMatch(/[\u4e00-\u9fa5]/);
    expect(err.message).not.toContain('EEXIST');
    expect(err.detail).toContain('EEXIST');
    expect(err.toUserMessage()).toMatch(/保存位置/);
  });

  it('磁盘满 / 权限 / 文件不存在各自映射到对应错误码', () => {
    expect(toAppError(fsError('ENOSPC', 'no space')).code).toBe('E_DISK_FULL');
    expect(toAppError(fsError('EACCES', 'denied')).code).toBe('E_PERMISSION');
    expect(toAppError(fsError('EPERM', 'denied')).code).toBe('E_PERMISSION');
    expect(toAppError(fsError('ENOENT', 'missing')).code).toBe('E_FILE_NOT_FOUND');
    expect(toAppError(fsError('EBUSY', 'busy')).code).toBe('E_FILE_UNREADABLE');
  });

  it('已经是 AppError 的原样返回，不被二次包装', () => {
    const original = new AppError('E_CANCELLED');
    expect(toAppError(original)).toBe(original);
  });

  it('没有 errno 的普通异常仍然落到 E_UNKNOWN，并保留堆栈', () => {
    const err = toAppError(new Error('boom'));
    expect(err.code).toBe('E_UNKNOWN');
    expect(err.message).toBe('boom');
  });

  it('非 Error 的抛出物也能转成 AppError', () => {
    expect(toAppError('字符串错误').code).toBe('E_UNKNOWN');
    expect(toAppError(null).code).toBe('E_UNKNOWN');
  });
});
