/**
 * Toast 通知。
 *
 * 与原型一致的三条规则：
 *   · 底部居中堆叠，最多同时 3 条（超出的挤掉最旧的）
 *   · success / info 2200ms 自动消失，warning / error 4000ms
 *   · 手动关闭时走 200ms 淡出动画再移除元素
 */
import { useEffect, useState, type ReactElement } from 'react';
import { cn } from '../../lib/cn';
import { useAppStore, type ToastItem, type ToastType } from '../../store/useAppStore';
import { Icon, type IconName } from './Icon';

const TOAST_ICON: Record<ToastType, IconName> = {
  success: 'i-check',
  info: 'i-info',
  warning: 'i-alert',
  error: 'i-alert',
};

const LIFE: Record<ToastType, number> = {
  success: 2200,
  info: 2200,
  warning: 4000,
  error: 4000,
};

function Toast({ item }: { item: ToastItem }): ReactElement {
  const dismiss = useAppStore((s) => s.dismissToast);
  const [out, setOut] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setOut(true), LIFE[item.type]);
    return () => window.clearTimeout(timer);
  }, [item.type]);

  useEffect(() => {
    if (!out) return undefined;
    const timer = window.setTimeout(() => dismiss(item.id), 200);
    return () => window.clearTimeout(timer);
  }, [out, dismiss, item.id]);

  return (
    <div className={cn('toast', `is-${item.type}`, out && 'is-out')} role="status">
      <Icon name={TOAST_ICON[item.type]} className="t-ico" />
      <span className="t-msg">{item.message}</span>
      <button
        type="button"
        className="t-close"
        aria-label="关闭"
        onClick={() => {
          setOut(true);
        }}
      >
        <Icon name="i-x" />
      </button>
    </div>
  );
}

export function ToastStack(): ReactElement {
  const toasts = useAppStore((s) => s.toasts);
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>
  );
}
