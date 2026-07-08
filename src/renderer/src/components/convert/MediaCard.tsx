/**
 * 已载入文件卡（原型 .filecard）。
 *
 * 左侧 160×90 缩略图（ffmpeg 抽帧，取不到就退回胶片图标），
 * 右侧三行：文件名 + 「更换」/ 规格 / 音轨。
 *
 * 纪律：**不显示编码器名字**。原型里明确要求界面上不出现 h264 / aac 这类词
 * （用户关心的是"能不能用"，不是"什么编码"），这里保持同一口径。
 */
import type { ReactElement } from 'react';
import type { MediaMeta } from '../../../../shared/types';
import { fmtDur, fmtSize } from '../../lib/format';
import { Icon } from '../ui/Icon';

interface MediaCardProps {
  meta: MediaMeta;
  thumb: string | null;
  onReplace: () => void;
}

function fpsText(fps: number): string {
  return `${Number.isInteger(fps) ? fps : fps.toFixed(2)}fps`;
}

function audioText(meta: MediaMeta): string {
  const a = meta.audio;
  if (!a) return '音频：无音轨';
  const layout = a.channels >= 6 ? '5.1 声道' : a.channels === 2 ? '立体声' : '单声道';
  const khz = a.sampleRate ? `${Math.round(a.sampleRate / 1000)}kHz` : '';
  return `音频：${layout}${khz ? ` · ${khz}` : ''}`;
}

export function MediaCard({ meta, thumb, onReplace }: MediaCardProps): ReactElement {
  const v = meta.video;
  const spec = v
    ? [fmtSize(meta.sizeBytes), fmtDur(meta.durationSec), `${v.width}×${v.height}`, fpsText(v.fps)]
    : [fmtSize(meta.sizeBytes), fmtDur(meta.durationSec), '分辨率无法读取'];

  return (
    <div className="filecard">
      <div className="thumb">
        {thumb ? <img src={thumb} alt="" /> : <Icon name="i-film" />}
      </div>
      <div className="info">
        <div className="name-row">
          <div className="file-name">{meta.fileName}</div>
          <button type="button" className="btn-text" onClick={onReplace}>
            更换
          </button>
        </div>
        <div className="meta">{spec.join(' · ')}</div>
        <div className="meta-sub">{audioText(meta)}</div>
      </div>
    </div>
  );
}
