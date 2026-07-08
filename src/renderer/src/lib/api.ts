/**
 * window.api 的类型化封装。
 *
 * 主进程一律返回 IpcResult，这里统一拆包：
 * 成功返回数据，失败抛 IpcError（带 code / detail），
 * 让调用方可以用 try/catch 而不是到处判 `if (!res.ok)`。
 */
import type { IpcResult } from '../../../shared/types';

export class IpcError extends Error {
  readonly code: string;
  readonly detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
    this.detail = detail;
  }
}

export async function call<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const res = await promise;
  if (res.ok) return res.data;
  throw new IpcError(res.error.code, res.error.message, res.error.detail);
}

/** 把任意异常转成可展示的中文文案 */
export function messageOf(err: unknown): string {
  if (err instanceof IpcError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function codeOf(err: unknown): string {
  return err instanceof IpcError ? err.code : 'E_UNKNOWN';
}

export function detailOf(err: unknown): string | undefined {
  return err instanceof IpcError ? err.detail : undefined;
}
