/**
 * 输出格式选择（原型 #fmtGrid，4×2 八宫格）。
 *
 * 交互细节（改了就与原型不一致）：
 *   · hover **不做位移**，只换边框色 + shadow-sm
 *   · 选中态靠 aria-pressed，右上角打勾
 */
import type { ReactElement } from 'react';
import { CONTAINERS, CONTAINER_ORDER } from '../../../../shared/containers';
import type { ContainerKey } from '../../../../shared/types';
import { Icon } from '../ui/Icon';

interface TargetPickerProps {
  value: ContainerKey;
  disabled?: boolean;
  onChange: (target: ContainerKey) => void;
}

export function TargetPicker({ value, disabled, onChange }: TargetPickerProps): ReactElement {
  return (
    <div className="fmt-grid" role="group" aria-label="输出格式">
      {CONTAINER_ORDER.map((key) => {
        const spec = CONTAINERS[key];
        return (
          <button
            key={key}
            type="button"
            className="fmt"
            aria-pressed={value === key}
            disabled={disabled}
            onClick={() => onChange(key)}
          >
            <span className="fname">{spec.label}</span>
            <span className="fdesc">{spec.desc}</span>
            <span className="tick">
              <Icon name="i-check" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
