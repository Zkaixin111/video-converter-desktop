/**
 * 图标集。
 *
 * 直接沿用 UI 原型的 symbol 定义（路径数据一字未改），
 * 用 <use> 引用同一份 sprite，避免把 20 多个图标各写一遍组件。
 * 好处：图标与原型像素级一致；后续换图标只改这一处。
 */
import type { CSSProperties, ReactElement } from 'react';

const ICONS = {
  'i-convert': (
    <>
      <path d="M4 8h13l-3-3" />
      <path d="M20 16H7l3 3" />
    </>
  ),
  'i-queue': (
    <>
      <line x1="8" y1="7" x2="20" y2="7" />
      <line x1="8" y1="12" x2="20" y2="12" />
      <line x1="8" y1="17" x2="20" y2="17" />
      <circle cx="4" cy="7" r=".6" fill="currentColor" />
      <circle cx="4" cy="12" r=".6" fill="currentColor" />
      <circle cx="4" cy="17" r=".6" fill="currentColor" />
    </>
  ),
  'i-preset': (
    <>
      <line x1="5" y1="21" x2="5" y2="14" />
      <line x1="5" y1="9" x2="5" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="7" x2="12" y2="3" />
      <line x1="19" y1="21" x2="19" y2="16" />
      <line x1="19" y1="11" x2="19" y2="3" />
      <line x1="2.5" y1="14" x2="7.5" y2="14" />
      <line x1="9.5" y1="7" x2="14.5" y2="7" />
      <line x1="16.5" y1="16" x2="21.5" y2="16" />
    </>
  ),
  'i-settings': (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.6 3V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  'i-info': (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <circle cx="12" cy="8" r=".7" fill="currentColor" stroke="none" />
    </>
  ),
  'i-upload': (
    <>
      <path d="M12 16V4" />
      <path d="M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  'i-film': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="7.5" y1="4" x2="7.5" y2="20" />
      <line x1="16.5" y1="4" x2="16.5" y2="20" />
      <line x1="3" y1="9" x2="7.5" y2="9" />
      <line x1="3" y1="15" x2="7.5" y2="15" />
      <line x1="16.5" y1="9" x2="21" y2="9" />
      <line x1="16.5" y1="15" x2="21" y2="15" />
    </>
  ),
  'i-check': <polyline points="4 12.5 9.5 18 20 6.5" />,
  'i-alert': (
    <>
      <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <line x1="12" y1="9" x2="12" y2="13.5" />
      <circle cx="12" cy="17.2" r=".8" fill="currentColor" stroke="none" />
    </>
  ),
  'i-x': (
    <>
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </>
  ),
  'i-folder': (
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
  ),
  'i-clock': (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </>
  ),
  'i-lock': (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>
  ),
  'i-zap': <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  'i-shield': <path d="M12 2.5 4.5 5.5v6c0 4.6 3.2 8.4 7.5 10 4.3-1.6 7.5-5.4 7.5-10v-6z" />,
  'i-badge-check': (
    <>
      <path d="m12 2.5 2.4 1.8 3-.2.9 2.9 2.4 1.8-1 2.8 1 2.8-2.4 1.8-.9 2.9-3-.2L12 21.5l-2.4-1.8-3 .2-.9-2.9L3.3 15l1-2.8-1-2.8L5.7 7l.9-2.9 3 .2z" />
      <polyline points="8.8 12 11 14.2 15.4 9.8" />
    </>
  ),
  'i-minus': <line x1="4" y1="12" x2="20" y2="12" />,
  'i-chevron-right': <polyline points="9 5 16 12 9 19" />,
  'i-chevron-down': <polyline points="5 9 12 16 19 9" />,
  'i-square': <rect x="5" y="5" width="14" height="14" rx="1" />,
  'i-copy': (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15" />
    </>
  ),
  'i-external': (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8 8" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  'i-refresh': (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <polyline points="20 4 20 11 13 11" />
    </>
  ),
  'i-arrow-right': (
    <>
      <line x1="4" y1="12" x2="19" y2="12" />
      <polyline points="13.5 6.5 19 12 13.5 17.5" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;

/** 全站只挂一次：把 symbol 定义塞进 DOM，供 <Icon> 用 <use> 引用 */
export function IconSprite(): ReactElement {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        {Object.entries(ICONS).map(([id, children]) => (
          <symbol
            key={id}
            id={id}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={id === 'i-check' ? 2.2 : id === 'i-x' ? 1.8 : 1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {children}
          </symbol>
        ))}
      </defs>
    </svg>
  );
}

interface IconProps {
  name: IconName;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, className, style }: IconProps): ReactElement {
  return (
    <svg className={className} style={style} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}
