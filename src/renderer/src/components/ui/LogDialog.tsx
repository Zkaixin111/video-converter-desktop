/**
 * 单次任务的日志片段（TODO-11）。
 *
 * 只显示「这一个 jobId」的日志行，而不是整份 app.log：
 * 用户报「这个文件转失败」时，别的任务记录对他毫无用处，只会让人看不下去。
 *
 * 没有日志行时不显示空白框，而是直说「这次任务没有留下日志」——
 * 空的等宽文本框会让用户以为界面坏了。
 */
import { useEffect, useState, type ReactElement } from 'react';
import { call, messageOf } from '../../lib/api';
import { Button } from './Button';

interface LogDialogProps {
  jobId: string;
  fileName: string;
  onClose: () => void;
}

export function LogDialog({ jobId, fileName, onClose }: LogDialogProps): ReactElement {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    void window.api
      .jobLog(jobId)
      .then(async (res) => {
        if (!alive) return;
        setLines(res.ok ? res.data.lines : []);
      })
      .catch(() => {
        if (alive) setLines([]);
      });
    return () => {
      alive = false;
    };
  }, [jobId]);

  // Esc 关闭：这是唯一的键盘出口，否则键盘用户会被困在弹层里
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const copy = async (): Promise<void> => {
    try {
      await call(window.api.copyText((lines ?? []).join('\n')));
    } catch (err) {
      void messageOf(err);
    }
  };

  return (
    <div className="dlg-mask" onClick={onClose}>
      <div
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-label={`${fileName} 的转换日志`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dlg-head">
          <div className="dlg-title">本次转换的日志</div>
          <div className="dlg-sub">{fileName}</div>
          <button type="button" className="btn-text" onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </div>

        <div className="dlg-body">
          {lines === null ? <div className="dlg-empty">读取中…</div> : null}
          {lines !== null && lines.length === 0 ? (
            <div className="dlg-empty">这次任务没有留下日志记录。</div>
          ) : null}
          {lines !== null && lines.length > 0 ? (
            <pre className="dlg-log">{lines.join('\n')}</pre>
          ) : null}
        </div>

        <div className="dlg-actions">
          <span className="dlg-spacer" />
          <Button variant="secondary" disabled={!lines?.length} onClick={() => void copy()}>
            复制
          </Button>
          <Button variant="primary" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
