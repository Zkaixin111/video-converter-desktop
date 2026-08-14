/**
 * 极简文件日志。
 *
 * 只做三件事：按天一个文件、单文件超过 2MB 截断、任何写失败都不影响主流程。
 * 不引入 winston/pino —— 桌面端日志量很小，几百行的实现已经够用。
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;

let logFile: string | null = null;

function ensureFile(): string | null {
  if (logFile) return logFile;
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, 'app.log');

    // 超限就轮转一次，保留一份 .1
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_BYTES) {
      const bak = `${logFile}.1`;
      fs.rmSync(bak, { force: true });
      fs.renameSync(logFile, bak);
    }
    return logFile;
  } catch {
    return null;
  }
}

function write(level: string, args: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${level}] ${args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ')}\n`;

  const file = ensureFile();
  if (file) {
    try {
      fs.appendFileSync(file, line);
    } catch {
      /* 日志失败不能影响业务流程 */
    }
  }
  // 开发态同时打到终端
  if (!app.isPackaged) process.stdout.write(line);
}

/** 按天？不，当前只有一个 app.log；轮转保留一份 .1 */
function candidateFiles(): string[] {
  const file = ensureFile();
  return file ? [file, `${file}.1`] : [];
}

export const logger = {
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args),
  getLogFilePath: () => ensureFile(),
  /** 日志目录：即使一条日志都还没写过，这个目录也是它该在的地方 */
  getLogDirPath: (): string | null => {
    const file = ensureFile();
    return file ? path.dirname(file) : null;
  },
  /**
   * 日志文件的当前内容（用于导出诊断包）。
   * 一条日志都没有时返回 null —— 调用方要据此给「暂无日志」，而不是打开一个空文件的目录。
   */
  snapshot: (): { name: string; text: string }[] => {
    const out: { name: string; text: string }[] = [];
    for (const file of candidateFiles()) {
      try {
        if (!fs.existsSync(file)) continue;
        out.push({ name: path.basename(file), text: fs.readFileSync(file, 'utf8') });
      } catch {
        /* 读不到就跳过，日志不该影响任何流程 */
      }
    }
    return out;
  },
  /**
   * 只取某个任务的日志片段（TODO-11）。
   *
   * 用户报「这个文件转失败」时，他要的是**这一次**的日志，
   * 而不是把几百行里别人的记录也一起摊开。
   */
  linesFor: (jobId: string): string[] => {
    if (!jobId) return [];
    const out: string[] = [];
    for (const file of candidateFiles()) {
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (line.includes(jobId)) out.push(line);
      }
    }
    return out;
  },
};
