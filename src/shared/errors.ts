/**
 * 错误码与错误对象。
 *
 * 设计要点：错误消息直接面向用户（中文、说人话、给下一步动作），
 * 技术细节放 `detail`，只进「复制诊断信息」，不糊到用户脸上。
 *
 * ⚠️ 本文件必须保持纯：不得 import node:* 或 electron（渲染进程也要用）。
 */

export type ErrorCode =
  | 'E_FILE_NOT_FOUND'
  | 'E_FILE_UNREADABLE'
  | 'E_PROBE_FAILED'
  | 'E_CORRUPT_FILE'
  | 'E_INVALID_INPUT'
  | 'E_NO_VIDEO_STREAM'
  | 'E_UNSUPPORTED_TARGET'
  | 'E_ENCODER_MISSING'
  | 'E_ENCODER_INIT'
  | 'E_DISK_FULL'
  | 'E_PERMISSION'
  | 'E_BUSY'
  | 'E_FFMPEG_FAILED'
  | 'E_FFMPEG_HUNG'
  | 'E_CANCELLED'
  | 'E_SPAWN_FAILED'
  | 'E_SAME_PATH'
  | 'E_OUTPUT_INVALID'
  | 'E_BINARY_MISSING'
  | 'E_BAD_REQUEST'
  | 'E_UNKNOWN';

/** 是否建议用户「换个格式试试」以外的重试 */
export const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'E_FILE_UNREADABLE',
  'E_DISK_FULL',
  'E_PERMISSION',
  'E_BUSY',
  'E_FFMPEG_FAILED',
  'E_FFMPEG_HUNG',
  'E_CANCELLED',
]);

/** 默认中文文案（无 hint 时的兜底） */
export const ERROR_TEXT: Record<ErrorCode, string> = {
  E_FILE_NOT_FOUND: '找不到这个文件，可能已经被移动或删除。',
  E_FILE_UNREADABLE: '无法读取这个文件，可能被其他程序占用或没有权限。',
  E_PROBE_FAILED: '无法解析这个文件的信息，它可能不是有效的视频文件。',
  E_CORRUPT_FILE: '这个文件没有正常结束，通常是下载或拷贝过程中断了。',
  E_INVALID_INPUT: '文件已损坏，或者后缀和真实格式不一致。',
  E_NO_VIDEO_STREAM: '这个文件里没有视频画面，不能转换成视频格式。',
  E_UNSUPPORTED_TARGET: '不支持这个输出格式。',
  E_ENCODER_MISSING: '当前版本不支持这个编码器。',
  E_ENCODER_INIT: '编码器初始化失败，通常是参数与源文件不兼容。',
  E_DISK_FULL: '输出磁盘空间不足。',
  E_PERMISSION: '无法写入输出文件，可能没有权限，或文件正被其他程序占用。',
  E_BUSY: '已有任务在进行中，请等它结束或先取消。',
  E_FFMPEG_FAILED: '转换失败。',
  E_FFMPEG_HUNG: '转码进程长时间无响应，已自动终止。',
  E_CANCELLED: '已取消转换。',
  E_SPAWN_FAILED: '无法启动转换引擎，请检查安装是否完整。',
  E_SAME_PATH: '输出路径与源文件相同，请换一个目录。',
  E_OUTPUT_INVALID: '转换完成但输出文件校验未通过，已删除损坏的文件。',
  E_BINARY_MISSING: '缺少转换组件（FFmpeg），无法开始转换。',
  E_BAD_REQUEST: '请求参数不合法。',
  E_UNKNOWN: '出现了未知错误。',
};

export interface AppErrorInit {
  hint?: string;
  detail?: string;
}

/**
 * 项目统一错误类型。
 * 不用原生 Error 的原因：需要携带 code（前端按码分支）与 hint（下一步动作）。
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly detail?: string;

  constructor(code: ErrorCode, message?: string, init: AppErrorInit = {}) {
    super(message ?? ERROR_TEXT[code]);
    this.name = 'AppError';
    this.code = code;
    this.hint = init.hint;
    this.detail = init.detail;
  }

  /** 供 UI 单行展示：主文案 + hint */
  toUserMessage(): string {
    return this.hint ? `${this.message} ${this.hint}` : this.message;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.toUserMessage(),
      detail: this.detail,
    };
  }
}

/**
 * Node 文件系统错误码 → 项目错误码。
 *
 * 为什么要在这一层统一翻译：任务失败时卡片上直接显示 message，
 * 如果放过原始错误，用户会看到 `EEXIST: file already exists, mkdir 'C:\...'`
 * 这种只有开发者能读的东西。原始信息不丢，转存进 detail（进「复制诊断信息」）。
 */
const FS_ERROR_MAP: Record<string, { code: ErrorCode; message?: string; hint?: string }> = {
  ENOENT: { code: 'E_FILE_NOT_FOUND' },
  EACCES: { code: 'E_PERMISSION' },
  EPERM: { code: 'E_PERMISSION' },
  EBUSY: { code: 'E_FILE_UNREADABLE' },
  ENOSPC: { code: 'E_DISK_FULL' },
  EEXIST: {
    code: 'E_PERMISSION',
    message: '无法写入输出位置：那里已经存在一个同名的文件或文件夹。',
    hint: '换一个保存位置，或先处理掉同名文件再试。',
  },
  ENOTDIR: {
    code: 'E_PERMISSION',
    message: '输出位置不是一个文件夹，无法写入。',
    hint: '换一个保存位置再试。',
  },
  EROFS: { code: 'E_PERMISSION', message: '输出位置是只读的，无法写入。' },
};

/** 把任意异常归一化成 AppError：IPC 边界上统一用它兜底 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    const mapped = code ? FS_ERROR_MAP[code] : undefined;
    if (mapped) {
      return new AppError(mapped.code, mapped.message, {
        hint: mapped.hint,
        detail: `${code}: ${err.message}`,
      });
    }
    return new AppError('E_UNKNOWN', err.message, { detail: err.stack });
  }
  return new AppError('E_UNKNOWN', String(err));
}

/** FFmpeg 错误里末 20 行是我们关心的，避免把整个日志塞给用户 */
export function tailLines(text: string, n = 20): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.slice(-n).join('\n');
}
