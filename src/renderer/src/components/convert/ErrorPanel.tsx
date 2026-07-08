/**
 * 失败卡（原型 #stageError）。
 *
 * 三条纪律：
 *   · 左侧红条，不用整块红底（红底会把错误放大成"崩溃"的观感）
 *   · 主文案说人话，技术细节只进「复制诊断信息」
 *   · **不提供「重试」**——同一个文件同一个格式重试大概率还是失败，
 *     正确的下一步是换格式或换源文件
 */
import type { ReactElement } from 'react';
import type { JobError } from '../../../../shared/types';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

interface ErrorPanelProps {
  error: JobError;
  onCopyDiagnostics: () => void;
  onTryAnother: () => void;
}

export function ErrorPanel({ error, onCopyDiagnostics, onTryAnother }: ErrorPanelProps): ReactElement {
  return (
    <div className="card error-card">
      <div className="error-title">
        <Icon name="i-alert" />
        <span>转换失败</span>
      </div>
      <p>{error.message}</p>
      <div className="error-actions">
        <Button variant="secondary" onClick={onCopyDiagnostics}>
          <Icon name="i-copy" />
          复制诊断信息
        </Button>
        <Button variant="secondary" onClick={onTryAnother}>
          换个格式试试
        </Button>
      </div>
    </div>
  );
}
