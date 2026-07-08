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

export const logger = {
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args),
  getLogFilePath: () => ensureFile(),
};
