/**
 * FFmpeg / ffprobe 二进制路径解析。
 *
 * 开发态：<项目根>/resources/bin/<platform>-<arch>/ffmpeg.exe
 * 打包态：<安装目录>/resources/bin/ffmpeg.exe   ← extraResources 复制过去
 *
 * 这两条路径写错任意一处，打包后必然 ENOENT，而且只在装完才暴露，
 * 所以这里把两种形态写成显式分支，而不是靠一个相对路径蒙。
 */
import { app } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Capabilities } from '../../../shared/types';

const execFileAsync = promisify(execFile);

const BIN_DIR_NAME = 'bin';
const EXE = process.platform === 'win32' ? '.exe' : '';

/**
 * 项目根目录。
 *
 * 纯 Node 环境（vitest 集成测试、脚本）里 `electron` 模块只会导出一个路径字符串，
 * 此时 `app` 是 undefined —— 直接调 `app.getAppPath()` 会抛错。
 * 这里兜底到 process.cwd()，让同一份路径解析逻辑在测试里也能跑通，
 * 不必为此在测试里 mock 整个 electron。
 */
function appRoot(): string {
  try {
    return app.getAppPath();
  } catch {
    return process.cwd();
  }
}

function isPackaged(): boolean {
  try {
    return app.isPackaged === true;
  } catch {
    return false;
  }
}

function resolveBinRoot(): string {
  // 打包态与开发态保持**同一个相对结构**（bin/<平台>-<架构>/），只换 base 目录。
  // 两边共用一套拼装逻辑，才不会出现「开发能跑、装完 ENOENT」这种只在安装后才暴露的问题。
  const binRoot = isPackaged()
    ? path.join(process.resourcesPath, BIN_DIR_NAME)
    : path.join(appRoot(), 'resources', BIN_DIR_NAME);
  return path.join(binRoot, `${process.platform}-${process.arch}`);
}

export function getFfmpegPath(): string {
  return path.join(resolveBinRoot(), `ffmpeg${EXE}`);
}

export function getFfprobePath(): string {
  return path.join(resolveBinRoot(), `ffprobe${EXE}`);
}

export interface BinaryCheck {
  ok: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  version: string | null;
  hasLibx264: boolean;
  missing: string[];
}

/** 缓存自检结果：每次启动只跑一次，缺失时由上层决定是否重试 */
let cached: BinaryCheck | null = null;

/**
 * 启动自检。
 * 除了「文件在不在」，还要确认 `-encoders` 里有 libx264 ——
 * LGPL 精简版 ffmpeg 没有 x264，转 H.264 会直接 Unknown encoder，
 * 这是这类工具最高频的翻车点，提前查出来比让用户转到一半失败好得多。
 */
export async function verifyBinaries(force = false): Promise<BinaryCheck> {
  if (cached && !force) return cached;

  const ffmpegPath = getFfmpegPath();
  const ffprobePath = getFfprobePath();
  const missing: string[] = [];

  for (const [label, p] of [
    ['ffmpeg', ffmpegPath],
    ['ffprobe', ffprobePath],
  ] as const) {
    if (!fs.existsSync(p)) missing.push(label);
  }

  let version: string | null = null;
  let hasLibx264 = false;

  if (missing.length === 0) {
    try {
      const { stdout } = await execFileAsync(ffmpegPath, ['-hide_banner', '-version'], {
        windowsHide: true,
        timeout: 10_000,
      });
      // 形如：ffmpeg version 9.0.2-full_build-www.gyan.dev Copyright ...
      const m = /ffmpeg version (\S+)/i.exec(stdout);
      version = m ? m[1] : null;
    } catch {
      missing.push('ffmpeg(不可执行)');
    }

    if (missing.length === 0) {
      try {
        const { stdout } = await execFileAsync(ffmpegPath, ['-hide_banner', '-encoders'], {
          windowsHide: true,
          timeout: 10_000,
        });
        hasLibx264 = /libx264/.test(stdout);
      } catch {
        hasLibx264 = false;
      }
    }
  }

  cached = {
    ok: missing.length === 0 && hasLibx264,
    ffmpegPath,
    ffprobePath,
    version,
    hasLibx264,
    missing,
  };
  return cached;
}

export function toCapabilities(check: BinaryCheck): Capabilities {
  let pkgVersion = '0.0.0';
  try {
    pkgVersion = app.getVersion();
  } catch {
    /* 纯 Node 环境（测试）里没有 app，返回占位版本号 */
  }
  return {
    ffmpeg: {
      ok: check.ok,
      version: check.version,
      hasLibx264: check.hasLibx264,
      ffmpegPath: check.ffmpegPath,
      ffprobePath: check.ffprobePath,
      missing: check.missing,
    },
    app: {
      version: pkgVersion,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
    },
    packaged: isPackaged(),
  };
}
