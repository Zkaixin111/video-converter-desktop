/**
 * 转换历史存储（纯 Node，不 import electron，可直接单测）。
 *
 * 为什么是一个 JSON 文件而不是数据库：
 *   · 一条记录不到 300 字节，100 条也就几十 KB，SQLite 的启动与迁移成本不值当
 *   · 历史是「可丢数据」：坏了重来即可，绝不能因为它让应用起不来
 *
 * 三条硬规则：
 *   1. 写入走「临时文件 + rename」，避免断电/崩溃留下半个 JSON
 *   2. 读取任何异常都退化成空列表并打日志，不往外抛
 *   3. 按 id 幂等：同一 jobId 重复 add 不会产生两条
 */
import fs from 'node:fs';
import path from 'node:path';
import { isPresetTier } from '../../../shared/containers';
import type { HistoryEntry, HistoryStatus } from '../../../shared/types';

/** 超出就淘汰最旧的。100 条足够回看，再多会让队列页变成负担 */
export const HISTORY_LIMIT = 100;

interface HistoryFile {
  version: 1;
  entries: HistoryEntry[];
}

const EMPTY: HistoryFile = { version: 1, entries: [] };

/**
 * 兼容旧版 `history.json`（TODO-07）。
 *
 * 旧版本只在成功时写历史，所以记录里没有 `status`、也没有 `preset`。
 * 这里一律按「成功 + standard 档位」补齐 —— 这正是老版本的真实行为，
 * 补齐后老数据既能展示也能重跑，不需要用户清空历史。
 */
export function normalizeEntry(e: HistoryEntry): HistoryEntry {
  const status: HistoryStatus =
    e.status === 'failed' || e.status === 'cancelled' ? e.status : 'done';
  return {
    ...e,
    status,
    preset: isPresetTier(e.preset) ? e.preset : 'standard',
  };
}

export class HistoryStore {
  private readonly file: string;
  private readonly limit: number;

  constructor(filePath: string, limit = HISTORY_LIMIT) {
    this.file = filePath;
    this.limit = limit;
  }

  get filePath(): string {
    return this.file;
  }

  /** 最新在前。文件不存在 / 损坏 / 权限异常都返回空列表 */
  list(): HistoryEntry[] {
    const data = this.read();
    return [...data.entries].sort((a, b) => b.finishedAt - a.finishedAt);
  }

  /** 按 id 取一条；没有就返回 null（「一键重跑」据此判定这条还在不在） */
  get(id: string): HistoryEntry | null {
    return this.read().entries.find((e) => e.id === id) ?? null;
  }

  /** 幂等追加：同 id 覆盖旧记录（重试成功后会带新时间） */
  add(entry: HistoryEntry): HistoryEntry[] {
    const data = this.read();
    const rest = data.entries.filter((e) => e.id !== entry.id);
    // 先按时间倒序整理再截断，保证淘汰的确实是最旧的
    const next = [entry, ...rest].sort((a, b) => b.finishedAt - a.finishedAt).slice(0, this.limit);
    this.write({ version: 1, entries: next });
    return next;
  }

  /** 删除单条（用户在列表里移除某次记录） */
  remove(id: string): HistoryEntry[] {
    const next = this.read().entries.filter((e) => e.id !== id);
    this.write({ version: 1, entries: next });
    return next.sort((a, b) => b.finishedAt - a.finishedAt);
  }

  clear(): void {
    this.write(EMPTY);
  }

  private read(): HistoryFile {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<HistoryFile>;
      if (!Array.isArray(parsed?.entries)) return { ...EMPTY, entries: [] };
      // 逐条做最小校验：宁可丢掉一条坏数据，也不要让界面拿到 undefined 崩掉
      const entries = parsed.entries.filter(
        (e): e is HistoryEntry =>
          !!e && typeof e === 'object' && typeof e.id === 'string' && typeof e.outputPath === 'string',
      );
      return { version: 1, entries: entries.map(normalizeEntry) };
    } catch {
      return { ...EMPTY, entries: [] };
    }
  }

  private write(data: HistoryFile): void {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');

    // rename 在 Windows 上偶发 EPERM/EBUSY：杀毒软件、搜索索引、刚被另一个
    // 进程打开过的目标文件都会让替换瞬间失败。历史是「写一次就完了」的数据，
    // 重试几次比直接丢掉这次记录划算（实测全量测试并发跑时会撞上）。
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        fs.renameSync(tmp, this.file);
        return;
      } catch (err) {
        lastErr = err;
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') break;
        sleepSync(20 * (attempt + 1));
      }
    }
    throw lastErr;
  }
}

/**
 * 同步小睡。
 *
 * 这里只能同步等待：write() 被 add() 同步调用，而 add() 在 job 的终态回调里，
 * 改成异步会把「历史写入」变成一条新的时序依赖。阻塞上限 200ms 且只在失败重试路径上。
 */
function sleepSync(ms: number): void {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}
