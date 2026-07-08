/**
 * 任务队列页（原型 #page-queue）。
 *
 * MVP 只展示「进行中」这一个任务：并发转换属于 P1，历史记录属于 P2。
 * 锁定的历史区用 pointer-events:none + 【待后续迭代】标明，不做假的空列表。
 */
import { useEffect, useState, type ReactElement } from 'react';
import { CONTAINERS } from '../../../shared/containers';
import { fmtDur } from '../lib/format';
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

export function QueuePage(): ReactElement {
  const stage = useAppStore((s) => s.stage);
  const meta = useAppStore((s) => s.meta);
  const target = useAppStore((s) => s.target);
  const plan = useAppStore((s) => s.plan);
  const progress = useAppStore((s) => s.progress);
  const cancel = useAppStore((s) => s.cancel);
  const setPage = useAppStore((s) => s.setPage);

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
          当前版本一次只处理一个文件。批量转换与历史记录属于后续迭代能力，本页仅展示进行中的任务。
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
        <span className="badge-iter">待后续迭代</span>
      </div>
      <div className="locked">
        <div className="empty-block">
          <div className="e-ico">
            <Icon name="i-clock" />
          </div>
          <h3>历史记录功能正在开发中</h3>
          <p>后续版本会保存你的转换记录，方便随时找回</p>
          <Button variant="secondary" onClick={() => setPage('convert')}>
            返回转换页
          </Button>
        </div>
      </div>
    </section>
  );
}
