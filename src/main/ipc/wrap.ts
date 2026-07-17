/**
 * IPC 统一包装与入参校验。
 *
 * 两个原则：
 *   · 永远返回 IpcResult，不抛异常 —— Electron 会把异常序列化成
 *     「Error invoking remote method ...」这种既难解析又难看的东西。
 *   · 每个 handler 都做运行时校验 —— 渲染进程理论上可信，但安全边界要按不可信设计。
 */
import path from 'node:path';
import { AppError, toAppError } from '../../shared/errors';
import type { IpcResult } from '../../shared/types';

export async function wrap<T>(fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    const e = toAppError(err);
    return { ok: false, error: { code: e.code, message: e.toUserMessage(), detail: e.detail } };
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError('E_BAD_REQUEST', `参数 ${field} 必须是非空字符串。`);
  }
  return value;
}

/** 只接受绝对路径：相对路径在打包态会相对到安装目录，必然是 bug */
export function requireAbsPath(value: unknown, field: string): string {
  const s = requireString(value, field);
  if (!path.isAbsolute(s)) {
    throw new AppError('E_BAD_REQUEST', `参数 ${field} 必须是绝对路径。`);
  }
  return s;
}

export function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new AppError('E_BAD_REQUEST', `参数 ${field} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

export function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError('E_BAD_REQUEST', `参数 ${field} 必须是非空数组。`);
  }
  return value;
}
