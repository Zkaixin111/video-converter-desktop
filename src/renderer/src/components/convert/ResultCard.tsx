/**
 * 完成卡（原型 #stageDone）。
 *
 * 相比原型多一行「校验徽章」——方案 §7-Q3 确认过：转换完必须告诉用户
 * 「这个文件是能用的」还是「能用但有隐患」，这是本产品相对同类工具的差异点。
 */
import type { ReactElement } from 'react';
import type { JobResult } from '../../../../shared/types';
import { fmtSize, fmtDur } from '../../lib/format';
import { MODE_LABEL } from '../../lib/mode';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

interface ResultCardProps {
  result: JobResult;
  onOpenFolder: () => void;
  onAgain: () => void;
}

function deltaOf(from: number, to: number): { text: string; flat: boolean } {
  if (from <= 0) return { text: '', flat: true };
  const ratio = to / from;
  const diff = Math.abs(ratio - 1);
  if (diff < 0.03) return { text: '体积基本不变，画质完全保留', flat: true };
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  return ratio < 1 ? { text: `减少 ${pct}%`, flat: false } : { text: `增加 ${pct}%`, flat: true };
}

export function ResultCard({ result, onOpenFolder, onAgain }: ResultCardProps): ReactElement {
  const outName = result.outputPath.split(/[\\/]/).pop() ?? result.outputPath;
  const delta = deltaOf(result.sourceSizeBytes, result.outputSizeBytes);

  return (
    <div className="card result-card">
      <div className="result-top">
        <div className="ico-ok">
          <Icon name="i-check" />
        </div>
        <div className="result-body">
          <div className="result-title">转换完成</div>
          <div className="result-file">{outName}</div>

          <div className="result-size">
            <span className="num">{fmtSize(result.sourceSizeBytes)}</span>
            <span className="arrow">→</span>
            <span className="num">{fmtSize(result.outputSizeBytes)}</span>
            {delta.text ? (
              <span className={delta.flat ? 'delta is-flat' : 'delta'}>{delta.text}</span>
            ) : null}
          </div>

          <div className="result-meta">
            耗时 {fmtDur(result.elapsedMs / 1000)} · {MODE_LABEL[result.mode]}
          </div>

          <div className={result.verified ? 'verify-line is-ok' : 'verify-line is-warn'}>
            <Icon name={result.verified ? 'i-badge-check' : 'i-alert'} />
            <span>
              {result.verified
                ? '已验证可播放'
                : `未能通过自动校验，建议实际播放确认${result.verifyDetail ? `（${result.verifyDetail}）` : ''}`}
            </span>
          </div>
        </div>
      </div>

      <div className="result-actions">
        <Button variant="secondary" onClick={onOpenFolder}>
          <Icon name="i-folder" />
          打开所在文件夹
        </Button>
        <Button variant="primary" onClick={onAgain}>
          再转一个
        </Button>
      </div>
    </div>
  );
}
