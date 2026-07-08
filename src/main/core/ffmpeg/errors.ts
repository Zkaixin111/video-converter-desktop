/**
 * ffmpeg stderr → 中文错误的翻译表。
 *
 * 顺序很重要：越具体的规则越靠前。最后一条 `Conversion failed` 是兜底，
 * 它几乎总会匹配，所以必须放在队尾。
 */
import { AppError, tailLines } from '../../../shared/errors';

interface Rule {
  re: RegExp;
  code:
    | 'E_CORRUPT_FILE'
    | 'E_INVALID_INPUT'
    | 'E_DISK_FULL'
    | 'E_PERMISSION'
    | 'E_ENCODER_MISSING'
    | 'E_ENCODER_INIT'
    | 'E_FFMPEG_FAILED';
  message: string;
  hint?: string;
}

const RULES: Rule[] = [
  {
    re: /moov atom not found/i,
    code: 'E_CORRUPT_FILE',
    message: '这个文件没有正常结束，通常是下载或拷贝过程中断了。',
    hint: '请重新获取原始文件。',
  },
  {
    re: /Invalid data found when processing input/i,
    code: 'E_INVALID_INPUT',
    message: '文件已损坏，或者后缀和真实格式不一致。',
    hint: '可以尝试用播放器打开确认：如果播放器也打不开，文件本身有问题。',
  },
  {
    re: /No space left on device|There is not enough space/i,
    code: 'E_DISK_FULL',
    message: '输出磁盘空间不足。',
    hint: '清理空间后重试，或换一个输出目录。',
  },
  {
    re: /Permission denied|being used by another process|Access is denied/i,
    code: 'E_PERMISSION',
    message: '无法写入输出文件，可能没有权限，或文件正被其他程序占用。',
    hint: '关闭正在使用该文件的程序，或换一个输出目录。',
  },
  {
    re: /Unknown encoder|Encoder .* not found|Unknown encoder .*/i,
    code: 'E_ENCODER_MISSING',
    message: '当前版本不支持这个编码器。',
    hint: '请尝试换一个输出格式。',
  },
  {
    re: /Error while opening encoder|Error initializing output stream|Specified pixel format .* is invalid/i,
    code: 'E_ENCODER_INIT',
    message: '编码器初始化失败，通常是参数与源文件不兼容。',
    hint: '请换一个输出格式重试。',
  },
  {
    re: /Conversion failed/i,
    code: 'E_FFMPEG_FAILED',
    message: '转换失败。',
    hint: '点击「复制诊断信息」，把内容发给我们可以帮你定位。',
  },
];

/**
 * @param stderr ffmpeg 的 stderr 全量文本
 * @param exitCode 退出码，仅用于诊断信息
 */
export function translateFfmpegError(stderr: string, exitCode?: number | null): AppError {
  const detail = `退出码: ${exitCode ?? 'unknown'}\n--- stderr (末 20 行) ---\n${tailLines(stderr, 20)}`;
  for (const r of RULES) {
    if (r.re.test(stderr)) {
      return new AppError(r.code, r.message, { hint: r.hint, detail });
    }
  }
  return new AppError('E_UNKNOWN', '转换过程中出现未知错误。', { detail });
}
