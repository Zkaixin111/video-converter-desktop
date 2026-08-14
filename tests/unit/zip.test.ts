/**
 * 诊断包用的最小 ZIP 写入器（TODO-11）。
 *
 * 自己写 ZIP 格式的风险是「写坏了自己还不知道」——
 * 生成的包在本机能生成，但别人用系统工具打不开就毫无意义。
 * 所以这里配一个最小读取器做**往返验证**：写进去什么，读出来必须一模一样。
 */
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createZip } from '../../src/main/core/fs/zip';

interface ReadEntry {
  name: string;
  data: Buffer;
}

/** 反着实现一遍 ZIP：读中央目录 → 定位本地头 → 按方法解压 */
function readZip(buf: Buffer): ReadEntry[] {
  // 结束记录（EOCD）在文件末尾，签名 0x06054b50
  const eocd = buf.readUInt32LE(buf.length - 22);
  expect(eocd).toBe(0x06054b50);

  const count = buf.readUInt16LE(buf.length - 22 + 10);
  let p = buf.readUInt32LE(buf.length - 22 + 16); // 中央目录偏移

  const out: ReadEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // 本地头：30 字节固定 + 文件名，之后就是数据
    const bodyAt = localAt + 30 + nameLen;
    const body = buf.subarray(bodyAt, bodyAt + compSize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);

    expect(data.length).toBe(rawSize);
    out.push({ name, data });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('createZip 往返', () => {
  it('单个文件写进去能原样读出来', () => {
    const zip = createZip([{ name: 'a.txt', data: Buffer.from('hello zip', 'utf8') }]);
    const entries = readZip(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('a.txt');
    expect(entries[0]?.data.toString('utf8')).toBe('hello zip');
  });

  it('多个文件都读得出来，且顺序与内容都不串', () => {
    const zip = createZip([
      { name: 'first.txt', data: Buffer.from('111', 'utf8') },
      { name: 'second.txt', data: Buffer.from('222', 'utf8') },
      { name: 'logs/third.txt', data: Buffer.from('333', 'utf8') },
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['first.txt', 'second.txt', 'logs/third.txt']);
    expect(entries.map((e) => e.data.toString('utf8'))).toEqual(['111', '222', '333']);
  });

  it('长文本是被压缩过的（方法 8），短文本原样存（方法 0）', () => {
    const long = Buffer.from('abcdefghij '.repeat(500), 'utf8');
    const zip = createZip([
      { name: 'long.txt', data: long },
      { name: 'short.txt', data: Buffer.from('x', 'utf8') },
    ]);
    // 压缩真的生效：重复文本压完只剩很小
    expect(zip.length).toBeLessThan(long.length);
    const map = Object.fromEntries(readZip(zip).map((e) => [e.name, e.data]));
    expect(map['long.txt']?.toString('utf8')).toBe(long.toString('utf8'));
    expect(map['short.txt']?.toString('utf8')).toBe('x');
  });

  it('中文文件名与中文内容都能无损往返', () => {
    const zip = createZip([{ name: '日志/app.log', data: Buffer.from('转换失败：E_FFMPEG_FAILED', 'utf8') }]);
    const [entry] = readZip(zip);
    expect(entry?.name).toBe('日志/app.log');
    expect(entry?.data.toString('utf8')).toBe('转换失败：E_FFMPEG_FAILED');
  });

  it('空包也能生成合法的 ZIP（一条都没有时不炸）', () => {
    const zip = createZip([]);
    expect(readZip(zip)).toEqual([]);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });

  it('时间戳可复现：传入固定时间时字节完全一致', () => {
    const at = new Date(2026, 9, 18, 9, 30, 0);
    const a = createZip([{ name: 'a.txt', data: Buffer.from('x', 'utf8') }], at);
    const b = createZip([{ name: 'a.txt', data: Buffer.from('x', 'utf8') }], at);
    expect(a.equals(b)).toBe(true);
  });
});
