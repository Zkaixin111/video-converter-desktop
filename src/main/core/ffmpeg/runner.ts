/**
 * FFmpeg 执行器。
 *
 * 三个必须做对的地方：
 *   ① 参数必须走数组 + `shell: false`，任何字符串拼接都会在中文/空格路径上炸，且是注入面。
 *   ② `-progress pipe:1` 的 `out_time_ms` 名字骗人，单位其实是微秒。
 *   ③ Windows 上 `child.kill()` 杀不掉进程树，取消要用 `taskkill /T /F`。
 */
import { execFile, spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { AppError } from '../../../shared/errors';
import { getFfmpegPath } from './paths';
import { translateFfmpegError } from './errors';

/** 连续这么久没有任何进度输出 → 判定假死 */
const WATCHDOG_MS = 90_000;
/** 进度回调节流 */
const THROTTLE_MS = 500;
/** stderr 只留最后这么多字符，避免长任务吃内存 */
const STDERR_LIMIT = 200_000;

export interface ProgressSample {
  processedSec: number;
  speed: number;
  /** 0~99，只有真正结束才是 100 */
  pct: number;
  etaSec: number | null;
  isEnd: boolean;
}

export interface RunOptions {
  inputPath: string;
  /** 注意：写 .part，不是最终文件 */
  outputPartPath: string;
  /** 来自 planner，不含输入输出与 -progress */
  args: string[];
  totalDurationSec: number;
  onProgress?: (sample: ProgressSample) => void;
}

export interface RunHandle {
  /** 正常结束 resolve；失败 reject(AppError) */
  promise: Promise<void>;
  cancel: () => Promise<void>;
}

/** 解析一段 -progress 输出；没有 out_time 时返回 null */
export function parseProgressChunk(
  chunk: string,
  totalDurationSec: number,
): ProgressSample | null {
  let outTimeUs = -1;
  let speed = 0;
  let isEnd = false;

  for (const rawLine of chunk.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);

    if (key === 'out_time_us') {
      const n = Number(value);
      if (Number.isFinite(n)) outTimeUs = n;
    } else if (key === 'out_time_ms' && outTimeUs < 0) {
      // 历史遗留的错误命名：值其实是微秒
      const n = Number(value);
      if (Number.isFinite(n)) outTimeUs = n;
    } else if (key === 'speed') {
      speed = Number.parseFloat(value.replace('x', '')) || 0;
    } else if (key === 'progress' && value.trim() === 'end') {
      isEnd = true;
    }
  }

  if (outTimeUs < 0 && !isEnd) return null;

  const processedSec = Math.max(0, outTimeUs / 1e6);
  const pct = isEnd
    ? 100
    : totalDurationSec > 0
      ? Math.min(99, (processedSec / totalDurationSec) * 100)
      : 0;
  const remaining = Math.max(0, totalDurationSec - processedSec);
  const etaSec = isEnd ? 0 : speed > 0 && totalDurationSec > 0 ? remaining / speed : null;

  return { processedSec, speed, pct, etaSec, isEnd };
}

/** Windows 上必须杀整棵树，否则 ffmpeg 的子进程会残留 */
async function killTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () =>
        resolve(),
      );
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* 已经退出 */
    }
  }
}

export function runConversion(options: RunOptions): RunHandle {
  const { inputPath, outputPartPath, args, totalDurationSec, onProgress } = options;

  const fullArgs = [
    '-hide_banner',
    '-y',
    '-i',
    inputPath,
    ...args,
    '-progress',
    'pipe:1',
    '-nostats',
    outputPartPath,
  ];

  let child: ChildProcessByStdio<null, Readable, Readable>;
  try {
    child = spawn(getFfmpegPath(), fullArgs, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // ⚠️ 永不开启 shell：参数数组直接交给 CreateProcess，不存在转义问题
      shell: false,
    });
  } catch (err) {
    return {
      promise: Promise.reject(
        new AppError('E_SPAWN_FAILED', '无法启动转换引擎。', { detail: String(err) }),
      ),
      cancel: async () => {},
    };
  }

  const pid = child.pid;
  let stderr = '';
  let cancelled = false;
  let settled = false;
  let lastProgressAt = Date.now();
  let lastEmitAt = 0;
  let lastSample: ProgressSample | null = null;

  const promise = new Promise<void>((resolve, reject) => {
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      fn();
    };

    // 看门狗：ffmpeg 有时会卡在坏扇区上，不输出也不退出
    const watchdog = setInterval(() => {
      if (Date.now() - lastProgressAt > WATCHDOG_MS) {
        void killTree(pid ?? 0);
        finish(() =>
          reject(
            new AppError('E_FFMPEG_HUNG', '转码进程长时间无响应，已自动终止。', {
              hint: '请确认源文件可以正常播放，或换一个格式重试。',
            }),
          ),
        );
      }
    }, 5_000);

    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      buffer += data;
      lastProgressAt = Date.now();

      // -progress 的一"块"以 progress=continue|end 结尾，按块解析最稳
      let idx = buffer.indexOf('progress=');
      while (idx >= 0) {
        const lineEnd = buffer.indexOf('\n', idx);
        if (lineEnd < 0) break;
        const chunk = buffer.slice(0, lineEnd + 1);
        buffer = buffer.slice(lineEnd + 1);

        const sample = parseProgressChunk(chunk, totalDurationSec);
        if (sample) {
          lastSample = sample;
          const now = Date.now();
          // 结束帧必须立刻推，否则 UI 会停在 99%
          if (now - lastEmitAt >= THROTTLE_MS || sample.isEnd) {
            lastEmitAt = now;
            onProgress?.(sample);
          }
        }
        idx = buffer.indexOf('progress=');
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (data: string) => {
      stderr = (stderr + data).slice(-STDERR_LIMIT);
    });

    child.on('error', (err) => {
      finish(() =>
        reject(
          new AppError('E_SPAWN_FAILED', '无法启动转换引擎。', { detail: String(err) }),
        ),
      );
    });

    child.on('close', (code) => {
      if (cancelled) {
        finish(() =>
          reject(new AppError('E_CANCELLED', '已取消转换。', { detail: stderr.slice(-2000) })),
        );
        return;
      }
      if (code === 0) {
        // 退出码 0 才置 100：进度条到 100 但文件没写完是最糟的体验
        onProgress?.({
          processedSec: totalDurationSec,
          speed: lastSample?.speed ?? 0,
          pct: 100,
          etaSec: 0,
          isEnd: true,
        });
        finish(resolve);
        return;
      }
      finish(() => reject(translateFfmpegError(stderr, code)));
    });
  });

  const cancel = async (): Promise<void> => {
    if (settled || cancelled) return;
    cancelled = true;
    if (pid) await killTree(pid);
  };

  return { promise, cancel };
}
