/**
 * 任务队列页（原型 #page-queue）。
 *
 * 「进行中」仍然是单任务：批量队列（P1-01）要先定交互，见 docs/ROADMAP-P1.md §5。
 * 「最近记录」从占位改成真实列表（P1-02）：数据来自主进程持久化的 history.json，
 * 只在转换成功时写入，失败/取消不进历史（否则列表全是噪音）。
 */
import { useEffect, useState, type ReactElement } from 'react';
import { CONTAINERS } from '../../../shared/containers';
import type { HistoryEntry } from '../../../shared/types';
import { fmtDur, fmtSize, fmtWhen } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';

function EmptyQueue(): ReactElement {
  const setPage = useAppStore((s) => s.setPage);
  return (
    <div className="empty-block">
      <div className="e-ico">
        <Icon name="i-queue" />
      </div>
      <h3>当前没有正在进行的任务</h3>
      <p>在转换页选择一个视频和格式就可以开始</p>
      <Button variant="secondary" onClick={() => setPage('convert')}>
        前往转换页
      </Button>
    </div>
  );
}

function EmptyHistory(): ReactElement {
  const setPage = useAppStore((s) => s.setPage);
  return (
    <div className="empty-block">
      <div className="e-ico">
        <Icon name="i-clock" />
      </div>
      <h3>还没有转换记录</h3>
      <p>每次转换成功后，这里会留下输出位置，方便随时找回</p>
      <Button variant="secondary" onClick={() => setPage('convert')}>
        返回转换页
      </Button>
    </div>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }): ReactElement {
  const toast = useAppStore((s) => s.toast);
  const remove = useAppStore((s) => s.removeHistory);

  return (
    <div className="queue-row is-history">
      <div className="q-ico">{CONTAINERS[entry.target].label}</div>
      <div className="q-body">
        <div className="q-name" title={entry.outputPath}>
          {entry.fileName} <span className="arrow">→</span> {CONTAINERS[entry.target].label}
        </div>
        <div className="q-meta">
          {fmtSize(entry.sourceSizeBytes)} → {fmtSize(entry.outputSizeBytes)} ·{' '}
          {entry.verified ? '已验证' : '未校验'} · {fmtWhen(entry.finishedAt)}
        </div>
      </div>
      <div className="q-right">
        <button type="button" className="btn-text" onClick={() => void remove(entry.id)}>
          移除
        </button>
        <Button
          variant="secondary"
          onClick={() => {
            void window.api.openFolder(entry.outputPath);
            toast('已打开输出文件夹', 'success');
          }}
        >
          打开
        </Button>
      </div>
    </div>
  );
}

export function QueuePage(): ReactElement {
  const stage = useAppStore((s) => s.stage);
  const meta = useAppStore((s) => s.meta);
  const target = useAppStore((s) => s.target);
  const plan = useAppStore((s) => s.plan);
  const progress = useAppStore((s) => s.progress);
  const cancel = useAppStore((s) => s.cancel);
  const history = useAppStore((s) => s.history);
  const clearHistory = useAppStore((s) => s.clearHistory);

  const running = stage === 'running';
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) return undefined;
    const t0 = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [running]);

  // 只处理单任务：没有运行中的任务就展示空态
  const showCurrent = running && meta;

  return (
    <section className="page" aria-label="任务队列">
      <header className="page-head">
        <h1>任务队列</h1>
        <p>当前任务的进度与最近记录。</p>
      </header>

      <div className="notice">
        <Icon name="i-info" />
        <div>
          当前版本一次只处理一个文件。成功完成的转换会留在下方「最近记录」，最多保留 100 条。
        </div>
      </div>

      <div className="section-label">进行中</div>
      <div>
        {showCurrent ? (
          <div className="queue-row">
            <div className="q-ico">{CONTAINERS[target].label}</div>
            <div className="q-body">
              <div className="q-name">
                {meta.fileName} <span className="arrow">→</span> {CONTAINERS[target].label}
              </div>
              <div className="q-bar">
                <i
                  style={{
                    width: `${plan?.mode === 'copy' ? 100 : (progress?.pct ?? 0)}%`,
                    opacity: plan?.mode === 'copy' ? 0.45 : 1,
                  }}
                />
              </div>
              <div className="q-meta">
                已用 {fmtDur(elapsed)} · 剩余约 {fmtDur(progress?.etaSec ?? null)}
              </div>
            </div>
            <div className="q-right">
              <span className="q-pct">
                {plan?.mode === 'copy' ? '处理中' : `${progress?.pct ?? 0}%`}
              </span>
              <Button variant="secondary" onClick={() => void cancel()}>
                取消
              </Button>
            </div>
          </div>
        ) : (
          <EmptyQueue />
        )}
      </div>

      <div className="section-head">
        <div className="section-label">最近记录</div>
        {history.length > 0 ? (
          <button type="button" className="btn-text" onClick={() => void clearHistory()}>
            清空历史
          </button>
        ) : null}
      </div>

      {history.length > 0 ? (
        <div className="queue-list">
          {history.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </div>
      ) : (
        <EmptyHistory />
      )}
    </section>
  );
}
