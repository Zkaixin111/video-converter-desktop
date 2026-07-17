/**
 * 任务队列页（原型 #page-queue）。
 *
 * 三条产品规格直接决定了这一页的结构：
 *
 *   1. **入队有两个入口**：转换页「开始转换」入队 1 条；拖拽 / 本页「添加文件」
 *      可以一次入队多条（store 的 addPaths 负责分流）。
 *
 *   2. **参数模式两种**：
 *        · 共用全局参数（默认）—— 条目不带 custom，执行时按全局面板解析
 *        · 单任务独立参数   —— 条目带 target + preset，可在队列里单独改
 *      注意「能不能编辑」判定的是**条目自身有没有 custom**，不是当前模式：
 *      用户中途把模式切回「共用全局」后，先前已经带参数入队的任务依然要能改，
 *      否则那些任务就永久锁死了。反过来，共享模式下新入队的任务天然没有 custom，
 *      自然也就没有编辑入口——这正是规格里「切换模式仅对后续新增任务生效」的落点。
 *
 *   3. **失败任务不静默消失**：标红 + 主进程落错误日志 + 支持单独重试/删除。
 *      「失败即暂停」策略下队列顶部出现提示条，点「继续队列」才往下跑。
 *
 * 数据全部来自主进程推送的 QueueSnapshot（单一事实来源），这里不维护第二份队列状态，
 * 否则「进度条走到了但卡片还是等待中」这类漂移迟早会出现。
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { CONTAINERS, CONTAINER_ORDER } from '../../../shared/containers';
import { canEditTask, canRemoveTask, canRetryTask } from '../../../shared/queue';
import type {
  ContainerKey,
  HistoryEntry,
  PresetTier,
  QueueItem,
  QueueMode,
} from '../../../shared/types';
import { TIERS } from '../lib/presets';
import { fmtDur, fmtSize, fmtWhen } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';

/** 档位 key → 中文名（与参数预设页共用同一份文案） */
const TIER_NAME = Object.fromEntries(TIERS.map((t) => [t.key, t.name])) as Record<PresetTier, string>;

function EmptyQueue(): ReactElement {
  const setPage = useAppStore((s) => s.setPage);
  const pickFiles = useAppStore((s) => s.pickFiles);

  return (
    <div className="empty-block">
      <div className="e-ico">
        <Icon name="i-queue" />
      </div>
      <h3>当前没有正在进行的任务</h3>
      <p>可以把多个视频一起拖进来，也可以一次选中多个文件加入队列</p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <Button variant="primary" onClick={() => void pickFiles()}>
          添加文件
        </Button>
        <Button variant="secondary" onClick={() => setPage('convert')}>
          前往转换页
        </Button>
      </div>
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
          <span className="q-fname">{entry.fileName}</span> <span className="arrow">→</span>{' '}
          {CONTAINERS[entry.target].label}
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

/**
 * 单任务参数编辑器（仅「单任务独立参数」条目可见）。
 *
 * 保存时把 { target, preset } 作为 custom 上报，主进程 updateParams 会连带
 * 重算输出路径——格式从 MP4 改成 WebM，扩展名必须一起变，否则会写出
 * 「名字是 .webm、内容是 mp4」的文件。
 */
function TaskEditor({ item, onClose }: { item: QueueItem; onClose: () => void }): ReactElement {
  const update = useAppStore((s) => s.updateQueueItem);

  const [target, setTarget] = useState<ContainerKey>(item.target);
  const [preset, setPreset] = useState<PresetTier>(item.preset);
  const [saving, setSaving] = useState(false);

  const dirty = target !== item.target || preset !== item.preset;

  const save = async (): Promise<void> => {
    setSaving(true);
    const ok = await update(item.jobId, { target, preset });
    setSaving(false);
    if (ok) onClose();
  };

  const followGlobal = async (): Promise<void> => {
    setSaving(true);
    const ok = await update(item.jobId, null);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div className="queue-edit">
      <div className="qe-row">
        <span className="qe-label">输出格式</span>
        <div className="fmt-mini" role="group" aria-label="输出格式">
          {CONTAINER_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              className="fmt-chip"
              aria-pressed={target === key}
              onClick={() => setTarget(key)}
            >
              {CONTAINERS[key].label}
            </button>
          ))}
        </div>
      </div>

      <div className="qe-row">
        <span className="qe-label">画质档位</span>
        <div className="segmented" role="group" aria-label="画质档位">
          {TIERS.map((tier) => (
            <button
              key={tier.key}
              type="button"
              aria-pressed={preset === tier.key}
              onClick={() => setPreset(tier.key)}
            >
              {tier.name}
            </button>
          ))}
        </div>
      </div>

      <div className="qe-actions">
        {item.custom ? (
          <button
            type="button"
            className="btn-text"
            disabled={saving}
            onClick={() => void followGlobal()}
          >
            改为跟随全局
          </button>
        ) : null}
        <span className="qe-spacer" />
        <Button variant="text" disabled={saving} onClick={onClose}>
          取消
        </Button>
        <Button variant="primary" disabled={saving || !dirty} onClick={() => void save()}>
          保存
        </Button>
      </div>
    </div>
  );
}

interface QueueRowProps {
  item: QueueItem;
  /** 队列里的位次（1 起）：只有等待中的任务显示 */
  rank: number;
  mode: QueueMode;
  editing: boolean;
  onToggleEdit: () => void;
  onCloseEdit: () => void;
}

function QueueRow({
  item,
  rank,
  mode,
  editing,
  onToggleEdit,
  onCloseEdit,
}: QueueRowProps): ReactElement {
  const cancelItem = useAppStore((s) => s.cancelQueueItem);
  const removeItem = useAppStore((s) => s.removeQueueItem);
  const retryItem = useAppStore((s) => s.retryQueueItem);

  const failed = item.status === 'error';
  const running = item.status === 'running' || item.status === 'preparing';
  const waiting = item.status === 'pending';
  // 条目自带参数，或当前处于「单任务独立参数」模式，才提供编辑入口
  const editable = (item.custom !== null || mode === 'per-task') && canEditTask(item.status);

  const pct = item.mode === 'copy' ? 100 : (item.progress?.pct ?? 0);

  const metaText = (): string => {
    if (failed) return `源文件 ${fmtSize(item.sourceSizeBytes)}`;
    if (item.status === 'preparing') return '准备中…';
    if (running) {
      const p = item.progress;
      const parts = [fmtSize(item.sourceSizeBytes)];
      if (p && p.totalSec > 0) {
        parts.push(`${fmtDur(p.processedSec)} / ${fmtDur(p.totalSec)}`);
      }
      if (p && p.speed > 0) parts.push(`${p.speed.toFixed(1)}×`);
      if (p) parts.push(`剩余约 ${fmtDur(p.etaSec)}`);
      return parts.join(' · ');
    }
    // 等待中
    const parts = [`等待中${rank > 0 ? ` · 第 ${rank} 位` : ''}`, `源文件 ${fmtSize(item.sourceSizeBytes)}`];
    parts.push(`档位 ${TIER_NAME[item.preset]}`);
    return parts.join(' · ');
  };

  return (
    <div className="queue-item">
      <div
        className={`queue-row${failed ? ' is-failed' : ''}${waiting ? ' is-pending' : ''}`}
      >
        <div className="q-ico">{CONTAINERS[item.target].label}</div>

        <div className="q-body">
          <div className="q-name" title={item.outputPath}>
            <span className="q-fname">{item.fileName}</span>
            <span className="arrow">→</span>
            <span>{CONTAINERS[item.target].label}</span>
            {item.custom ? (
              <span className="chip chip-custom">自定义</span>
            ) : (
              <span className="chip chip-global">跟随全局</span>
            )}
            {failed ? <span className="chip chip-fail">失败</span> : null}
            {editing ? <span className="chip chip-edit">编辑中</span> : null}
          </div>

          {running ? (
            <div className="q-bar">
              <i
                style={{
                  width: `${item.status === 'preparing' ? 2 : pct}%`,
                  opacity: item.mode === 'copy' ? 0.45 : 1,
                }}
              />
            </div>
          ) : null}

          <div className="q-meta">{metaText()}</div>

          {failed && item.error ? (
            <div className="q-error">
              {item.error.message}
              {item.error.hint ? <span className="q-hint"> · {item.error.hint}</span> : null}
            </div>
          ) : null}
        </div>

        <div className="q-right">
          {running ? (
            <>
              <span className="q-pct">
                {item.mode === 'copy' ? '处理中' : `${item.progress?.pct ?? 0}%`}
              </span>
              <Button variant="secondary" onClick={() => void cancelItem(item.jobId)}>
                取消
              </Button>
            </>
          ) : null}

          {waiting ? (
            <>
              {editable ? (
                <button type="button" className="btn-text" onClick={onToggleEdit}>
                  {editing ? '收起' : '编辑'}
                </button>
              ) : null}
              {canRemoveTask(item.status) ? (
                <Button variant="secondary" onClick={() => void removeItem(item.jobId)}>
                  移除
                </Button>
              ) : null}
            </>
          ) : null}

          {failed ? (
            <>
              {editable ? (
                <button type="button" className="btn-text" onClick={onToggleEdit}>
                  {editing ? '收起' : '编辑'}
                </button>
              ) : null}
              {canRetryTask(item.status) ? (
                <Button variant="secondary" onClick={() => void retryItem(item.jobId)}>
                  重试
                </Button>
              ) : null}
              {canRemoveTask(item.status) ? (
                <button
                  type="button"
                  className="btn-text is-danger"
                  onClick={() => void removeItem(item.jobId)}
                >
                  删除
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {editing ? <TaskEditor item={item} onClose={onCloseEdit} /> : null}
    </div>
  );
}

/** 「失败即暂停」时顶部的提示条 */
function PausedBanner(): ReactElement {
  const resumeQueue = useAppStore((s) => s.resumeQueue);

  return (
    <div className="queue-paused" role="status">
      <div className="qp-ico">
        <Icon name="i-alert" />
      </div>
      <div className="qp-body">
        <div className="qp-title">队列已暂停</div>
        <div className="qp-desc">
          有任务转换失败，按设置里的「失败后暂停队列」停下了。处理完失败任务（重试或删除）后可继续，
          也可以直接继续。
        </div>
      </div>
      <Button variant="primary" onClick={() => void resumeQueue()}>
        继续队列
      </Button>
    </div>
  );
}

export function QueuePage(): ReactElement {
  const queue = useAppStore((s) => s.queue);
  const busy = useAppStore((s) => s.busy);
  const pickFiles = useAppStore((s) => s.pickFiles);
  const history = useAppStore((s) => s.history);
  const clearHistory = useAppStore((s) => s.clearHistory);
  const refreshQueue = useAppStore((s) => s.refreshQueue);

  const [editingId, setEditingId] = useState<string | null>(null);

  // 进页面拉一次最新快照：事件流可能有丢帧（窗口刚建好/刚从别的页面回来）
  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  // items 用 useMemo 固定引用：否则每次渲染都是新数组，下面那个清理编辑器的 effect 会白跑
  const items = useMemo(() => queue?.items ?? [], [queue]);
  const mode = queue?.mode ?? 'shared';

  // 进入终态后条目会被移出队列，编辑器不能指向一个已消失的任务
  useEffect(() => {
    if (editingId && !items.some((it) => it.jobId === editingId)) setEditingId(null);
  }, [editingId, items]);

  // 位次只在「等待中」的任务之间编号：第 1 位就是下一个要跑的
  let waitingSeq = 0;
  const ranked = items.map((item) => ({
    item,
    rank: item.status === 'pending' ? ++waitingSeq : 0,
  }));

  return (
    <section className="page" aria-label="任务队列">
      <header className="page-head has-actions">
        <div>
          <h1>任务队列</h1>
          <p>同一时刻只转换一个文件，其余任务按顺序排队；成功的结果会留在「最近记录」。</p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void pickFiles()}>
          添加文件
        </Button>
      </header>

      {queue?.paused ? <PausedBanner /> : null}

      <div className="section-head">
        <div className="section-label">队列</div>
        {items.length > 0 ? (
          <span className="q-count">{items.length} 个任务</span>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="queue-list">
          {ranked.map(({ item, rank }) => (
            <QueueRow
              key={item.jobId}
              item={item}
              rank={rank}
              mode={mode}
              editing={editingId === item.jobId}
              onToggleEdit={() =>
                setEditingId((cur) => (cur === item.jobId ? null : item.jobId))
              }
              onCloseEdit={() => setEditingId(null)}
            />
          ))}
        </div>
      ) : (
        <EmptyQueue />
      )}

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
