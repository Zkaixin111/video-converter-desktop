/**
 * 最小 ZIP 写入器（TODO-11）。
 *
 * 存在的理由只有一个：诊断包要把「日志 + 设置 + 引擎信息」几个文本文件合成一个附件。
 * 为这件事引入 archiver 会多一个运行时依赖，而诊断包一年也导不了几次——
 * 自己写 100 行，换掉一个依赖，是划算的。
 *
 * 只实现 ZIP 必需的三段结构（本地头 / 中央目录 / 结束记录），
 * 用 deflate 压缩（文本日志能压到 1/5），不加密、不分卷、不流式。
 */
import zlib from 'node:zlib';

/** ZIP 的时间戳是 MS-DOS 格式：7 bit 年偏移 + 4-5-5 的月日时分秒 */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  // 秒只存偶数：DOS 的秒字段只有 5 bit，精度是 2 秒
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { time, date };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** 包内路径，用正斜杠（ZIP 规范） */
  name: string;
  data: Buffer;
}

/** 逐字符判断而不是写正则：/\x00-\x7f/ 这类控制字符区间会被 lint 拦下 */
function hasNonAscii(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}

/**
 * 把若干条目打包成 ZIP 字节。
 *
 * 小于 64 字节的条目直接原样存（deflate 对这么短的文本只会变大），
 * 这是 libarchive / zipfile 都在做的取舍。
 */
export function createZip(entries: ZipEntry[], now = new Date()): Buffer {
  const { time, date } = dosDateTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = entry.data;
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const useStore = raw.length < 64;
    const body = useStore ? raw : zlib.deflateRawSync(raw, { level: 9 });
    const method = useStore ? 0 : 8;
    /**
     * UTF-8 名字标志（通用位标志 bit 11）。
     *
     * 不置这个位，解压方就会按 CP437 解文件名：中文文件名会变成乱码，
     * 在 Windows 上更会被当成非法字符，连包都打不开。
     */
    const flags = hasNonAscii(entry.name) ? 0x0800 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra 长度
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // 起始磁盘号
    central.writeUInt16LE(0, 36); // 内部属性
    central.writeUInt32LE(0, 38); // 外部属性
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // 注释长度

  return Buffer.concat([...locals, centralBuf, end]);
}
