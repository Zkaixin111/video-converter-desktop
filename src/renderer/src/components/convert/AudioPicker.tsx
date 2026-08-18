/**
 * 音频提取的目标格式（TODO-20）。
 *
 * 复用视频格式选择器的视觉（.fmt-grid / .fmt），只有两项，
 * 因为「把声音拿出来」这件事上格式没有太多选择空间：
 * MP3 是通用解，M4A 是苹果生态与同码率高音质解，再多就是噪音。
 */
import type { ReactElement } from 'react';
import { AUDIO_FORMATS, AUDIO_ORDER } from '../../../../shared/audio';
import type { AudioFormat } from '../../../../shared/types';
import { Icon } from '../ui/Icon';

interface AudioPickerProps {
  value: AudioFormat;
  disabled?: boolean;
  onChange: (format: AudioFormat) => void;
}

export function AudioPicker({ value, disabled, onChange }: AudioPickerProps): ReactElement {
  return (
    <div className="fmt-grid" role="group" aria-label="音频格式">
      {AUDIO_ORDER.map((key) => {
        const spec = AUDIO_FORMATS[key];
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
