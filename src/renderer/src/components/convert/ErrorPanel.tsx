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
  /** 当前任务的 jobId；null 时就不提供「查看本次日志」入口 */
  jobId: string | null;
  onViewLog: () => void;
  onCopyDiagnostics: () => void;
  onTryAnother: () => void;
}

export function ErrorPanel({
  error,
  jobId,
  onViewLog,
  onCopyDiagnostics,
  onTryAnother,
}: ErrorPanelProps): ReactElement {
  return (
    <div className="card error-card">
      <div className="error-title">
        <Icon name="i-alert" />
        <span>转换失败</span>
      </div>
      <p>{error.message}</p>
      <div className="error-actions">
        {jobId ? (
          // 「复制诊断信息」复制的是什么，用户一直不知道；这里让他能直接看到
          <Button variant="secondary" onClick={onViewLog}>
            查看本次日志
          </Button>
        ) : null}
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
