/**
 * 转换中进度卡（原型 #stageRunning）。
 *
 * 两种进度形态：
 *   · 重新压缩 / 混合直通 → 确定进度条（0~99%，只有真正结束才 100%）
 *   · 无损直通 → 不定长滑动条。几秒就结束，跳动的百分比反而制造不确定感
 *
 * 「已用」用真实墙钟计（不是 ffmpeg 处理的媒体时长），「剩余」优先用 ffmpeg 报的 ETA。
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { ConversionMode, ProgressPayload } from '../../../../shared/types';
import { fmtDur } from '../../lib/format';
import { MODE_RUNNING_TITLE } from '../../lib/mode';
import { Button } from '../ui/Button';

interface ProgressPanelProps {
  mode: ConversionMode;
  fileName: string;
  outputPath: string;
  progress: ProgressPayload | null;
  onCancel: () => void;
}

export function ProgressPanel({
  mode,
  fileName,
  outputPath,
  progress,
  onCancel,
}: ProgressPanelProps): ReactElement {
  const indeterminate = mode === 'copy';
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t0 = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, []);

  const outName = useMemo(() => outputPath.split(/[\\/]/).pop() ?? outputPath, [outputPath]);
  const pct = progress?.pct ?? 0;

  const metaText = indeterminate
    ? '正在处理，通常几秒内完成'
    : `已用 ${fmtDur(elapsed)} · 剩余约 ${fmtDur(progress?.etaSec ?? null)}`;

  return (
    <div className="card job-card">
      <div className="job-head">
        <div className="pulse-dot" />
        <div>
          <div className="job-title">{MODE_RUNNING_TITLE[mode]}</div>
          <div className="job-sub">
            {fileName}{' '}
            <span className="mono" style={{ color: 'var(--text-tertiary)' }}>
              →
            </span>{' '}
            <span className="mono">{outName}</span>
          </div>
        </div>
      </div>

      {indeterminate ? (
        <div className="indeterminate">
          <i />
        </div>
      ) : (
        <div className="progress-wrap">
          <div
            className="progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-pct">{pct}%</div>
        </div>
      )}

      <div className="job-meta">{metaText}</div>

      <div className="job-actions">
        {/* 取消是正常操作，不用危险色（与原型一致） */}
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}
