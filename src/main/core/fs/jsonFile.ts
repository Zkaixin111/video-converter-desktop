/**
 * userData 下小 JSON 文件的通用读写（纯 Node，可直接单测）。
 *
 * 这个项目要在 `%APPDATA%/<应用名>` 里放三个 JSON：设置、历史、队列快照。
 * 它们有一条共同的硬规则，所以收在这里统一保证，避免三处各写各的：
 *
 *   1. **写入是原子替换**（临时文件 + rename）
 *      断电、强杀、蓝屏都不会留下半个 JSON —— 半截 JSON 会让下一次启动
 *      读到的既不是新数据也不是旧数据。
 *   2. **读取失败一律返回 null，不往外抛**
 *      这三份数据都是「可丢数据」：坏了重来即可，绝不能因为它让应用起不来。
 *      要不要记日志由调用方决定（历史这类要静默，队列快照要告警）。
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * rename 的重试次数与退避。
 *
 * Windows 上 `renameSync` 偶发 EPERM / EBUSY：杀毒软件正在扫、Windows 搜索
 * 索引刚打开过目标文件、Another process... 都会让替换在那一瞬间失败。
 * 全量测试并发跑时实测会撞上，所以重试而不是直接放弃这次写入。
 */
const RENAME_ATTEMPTS = 4;

/**
 * 同步小睡。
 *
 * 这里只能同步等待：调用方（历史的 add、队列快照的 write）都处在同步流程里，
 * 改成异步会把「写入」变成一条新的时序依赖。阻塞上限几百毫秒且只在失败重试路径上。
 */
function sleepSync(ms: number): void {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}

/** 读取并 JSON 解析；文件不存在 / 损坏 / 不是对象都返回 null */
export function readJsonFile<T>(file: string): T | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/** 原子写入：先落 `.tmp`，再 rename 覆盖目标文件 */
export function writeJsonFile(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');

  let lastErr: unknown;
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      // 只有「临时性的占用」才值得重试；ENOENT/磁盘满之类的重试多少次都一样
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') break;
      sleepSync(20 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** 删除文件；不存在也算成功（幂等，启动时的清理路径要能用） */
export function deleteJsonFile(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* 删不掉不影响主流程：下次写入会覆盖它 */
  }
}
