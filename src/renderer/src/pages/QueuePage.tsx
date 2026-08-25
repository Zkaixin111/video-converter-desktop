/**
 * 任务队列页（原型 #page-queue）。
 *
 * 三条产品规格直接决定了这一页的结构：
 *
 *   1. **入队有两个入口**：转换页「开始转换」入队 1 条；拖拽 / 本页「添加文件」
 *      可以一次入队多条（store 的 enqueuePaths 负责，单次上限 10 个）。
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
import { AUDIO_FORMATS } from '../../../shared/audio';
import { canEditTask, canRemoveTask, canRetryTask } from '../../../shared/queue';
import type {
  ContainerKey,
  HistoryItem,
  HistoryStatus,
  PresetTier,
  QueueItem,
  QueueMode,
  QueueSnapshot,
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
      <p>每次转换结束（含失败与取消）都会记在这里，可以直接按原参数重跑</p>
      <Button variant="secondary" onClick={() => setPage('convert')}>
        返回转换页
      </Button>
    </div>
  );
}

/** 历史条目的结局标签（TODO-07）：失败/取消也要能一眼认出来 */
const HISTORY_STATUS: Record<HistoryStatus, { label: string; chip: string }> = {
  done: { label: '成功', chip: 'chip-ok' },
  failed: { label: '失败', chip: 'chip-fail' },
  cancelled: { label: '已取消', chip: 'chip-global' },
};

const HISTORY_FILTERS: { key: HistoryStatus | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'done', label: '成功' },
  { key: 'failed', label: '失败' },
  { key: 'cancelled', label: '已取消' },
];

function HistoryRow({ entry }: { entry: HistoryItem }): ReactElement {
  const toast = useAppStore((s) => s.toast);
  const remove = useAppStore((s) => s.removeHistory);
  const rerun = useAppStore((s) => s.rerunHistory);

  const status = HISTORY_STATUS[entry.status];
  const succeeded = entry.status === 'done';

  return (
    <div className={`queue-row is-history${entry.status === 'failed' ? ' is-failed' : ''}`}>
      <div className="q-ico">
        {entry.audio ? AUDIO_FORMATS[entry.audio].label : CONTAINERS[entry.target].label}
      </div>
      <div className="q-body">
        <div className="q-name" title={succeeded ? entry.outputPath : entry.sourcePath}>
          <span className="q-fname">{entry.fileName}</span> <span className="arrow">→</span>{' '}
          <span>
            {entry.audio ? AUDIO_FORMATS[entry.audio].label : CONTAINERS[entry.target].label}
          </span>
          {entry.audio ? <span className="chip chip-audio">仅音频</span> : null}
          <span className={`chip ${status.chip}`}>{status.label}</span>
        </div>

        {succeeded ? (
          <div className="q-meta">
            {fmtSize(entry.sourceSizeBytes)} → {fmtSize(entry.outputSizeBytes)} ·{' '}
            {entry.verified ? '已验证' : '未校验'} · {fmtWhen(entry.finishedAt)}
          </div>
        ) : (
          <div className="q-meta">
            {fmtWhen(entry.finishedAt)}
            {entry.error ? ` · ${entry.error.message}` : ''}
          </div>
        )}
      </div>
      <div className="q-right">
        <button type="button" className="btn-text" onClick={() => void remove(entry.id)}>
          移除
        </button>

        {succeeded ? (
          <Button
            variant="secondary"
            onClick={() => {
              void window.api.openFolder(entry.outputPath);
              toast('已打开输出文件夹', 'success');
            }}
          >
            打开
          </Button>
        ) : (
          // 源文件不在了就重跑不了：宁可给出原因，也不要让用户点了才发现
          <Button
            variant="primary"
            disabled={!entry.sourceExists}
            title={entry.sourceExists ? '按原参数重新转换' : '源文件已不在原位置，无法重跑'}
            onClick={() => void rerun(entry.id)}
          >
            重跑
          </Button>
        )}
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
      {/* 音频提取任务没有「输出格式」可改：它的目标格式是 mp3/m4a，
          由转换页的输出类型决定，这里改容器只会让用户以为生效了实际没生效 */}
      {item.audio ? null : (
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
      )}

      <div className="qe-row">
        <span className="qe-label">{item.audio ? '音质档位' : '画质档位'}</span>
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
  /* ── 拖拽排序（TODO-13） ─────────────────────────── */
  /** 这一行正被拖着 */
  dragging: boolean;
  /** 有东西正悬停在这一行上方 */
  over: boolean;
  onDragStartRow: () => void;
  onDragEnterRow: () => void;
  onDropRow: () => void;
  onDragEndRow: () => void;
  /** Alt+↑ / Alt+↓：键盘用户的排序入口 */
  onMoveStep: (delta: number) => void;
}

function QueueRow({
  item,
  rank,
  mode,
  editing,
  onToggleEdit,
  onCloseEdit,
  dragging,
  over,
  onDragStartRow,
  onDragEnterRow,
  onDropRow,
  onDragEndRow,
  onMoveStep,
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
    parts.push(`${item.audio ? '音质' : '画质'}档位 ${TIER_NAME[item.preset]}`);
    return parts.join(' · ');
  };

  return (
    <div className="queue-item">
      <div
        className={[
          'queue-row',
          failed ? 'is-failed' : '',
          waiting ? 'is-pending' : '',
          dragging ? 'is-dragging' : '',
          over ? 'is-drop' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        // 拖动改顺序：等待中的任务才能拖（正在跑的拖不动，改顺序也不该打断它）
        draggable={waiting}
        tabIndex={waiting ? 0 : undefined}
        aria-grabbed={waiting ? dragging : undefined}
        title={waiting ? '拖动调整顺序，或用 Alt + ↑ / ↓ 移动' : undefined}
        onDragStart={(e) => {
          if (!waiting) return;
          e.dataTransfer.effectAllowed = 'move';
          onDragStartRow();
        }}
        onDragEnter={() => {
          if (waiting) onDragEnterRow();
        }}
        onDragOver={(e) => {
          // 不 preventDefault 就收不到 drop —— 这是 HTML5 拖拽的默认约定
          if (waiting) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!waiting) return;
          e.preventDefault();
          onDropRow();
        }}
        onDragEnd={onDragEndRow}
        onKeyDown={(e) => {
          if (!waiting || !e.altKey) return;
          const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
          if (step === 0) return;
          e.preventDefault();
          onMoveStep(step);
        }}
      >
        {waiting ? (
          <span className="q-grip" aria-hidden="true">
            <Icon name="i-grip" style={{ width: 14, height: 14 }} />
          </span>
        ) : null}
        <div className="q-ico">
          {item.audio ? AUDIO_FORMATS[item.audio].label : CONTAINERS[item.target].label}
        </div>

        <div className="q-body">
          <div className="q-name" title={item.outputPath}>
            <span className="q-fname">{item.fileName}</span>
            <span className="arrow">→</span>
            <span>
              {item.audio ? AUDIO_FORMATS[item.audio].label : CONTAINERS[item.target].label}
            </span>
            {item.audio ? <span className="chip chip-audio">仅音频</span> : null}
            {item.interrupted ? <span className="chip chip-interrupted">上次未完成</span> : null}
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

/**
 * 队列停下时的提示条。
 *
 * 三种「停」要说三种话（TODO-12 恢复了/TODO-13 手动暂停/失败即暂停）：
 * 收成一句话「队列已暂停」的话，用户看不出这三者的差别，
 * 尤其「崩溃恢复」如果只说「已暂停」，他会以为是刚才暂停的、点继续就把一批任务全跑了。
 */
function PausedBanner({ snapshot }: { snapshot: QueueSnapshot }): ReactElement {
  const resumeQueue = useAppStore((s) => s.resumeQueue);

  const restored = snapshot.pausedReason === 'restored';
  const title = restored ? '上次没跑完的任务已恢复' : '队列已暂停';
  const desc = restored
    ? `这是上次程序意外退出时还在队列里的 ${snapshot.items.length} 个任务，已按原参数还原（标「上次未完成」的是当时正在转的）。确认无误后继续；也可以先调整顺序或删掉不想再转的。`
    : snapshot.pausedReason === 'manual'
      ? '已按你的操作暂停：正在跑的这个会跑完，剩下的不会启动。随时可以继续。'
      : '有任务转换失败，按设置里的「失败后暂停队列」停下了。处理完失败任务（重试或删除）后可继续，也可以直接继续。';

  return (
    <div className="queue-paused" role="status">
      <div className="qp-ico">
        <Icon name="i-alert" />
      </div>
      <div className="qp-body">
        <div className="qp-title">{title}</div>
        <div className="qp-desc">{desc}</div>
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
  const pauseQueue = useAppStore((s) => s.pauseQueue);
  const resumeQueue = useAppStore((s) => s.resumeQueue);
  const reorderItem = useAppStore((s) => s.reorderQueueItem);

  const historyFilter = useAppStore((s) => s.historyFilter);
  const setHistoryFilter = useAppStore((s) => s.setHistoryFilter);

  const [editingId, setEditingId] = useState<string | null>(null);
  /** 拖拽排序的两个瞬时状态：谁被拖着、正悬停在谁上面 */
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // 进页面拉一次最新快照：事件流可能有丢帧（窗口刚建好/刚从别的页面回来）
  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  // items 用 useMemo 固定引用：否则每次渲染都是新数组，下面那个清理编辑器的 effect 会白跑
  const items = useMemo(() => queue?.items ?? [], [queue]);
  const mode = queue?.mode ?? 'shared';
  const paused = queue?.paused === true;
  const hasLiveWork = items.some(
    (i) => i.status === 'pending' || i.status === 'preparing' || i.status === 'running',
  );

  /**
   * 等待中的任务序列。
   *
   * 拖拽与键盘都换算成「在等待序列里移动几位」：这条序列是用户眼里的排队顺序，
   * 而数组里还可能夹着正在跑的任务——拿它在数组里的绝对下标会算错。
   */
  const pendingSeq = useMemo(
    () => items.filter((i) => i.status === 'pending').map((i) => i.jobId),
    [items],
  );

  const moveFrom = (jobId: string, targetId: string): void => {
    const from = pendingSeq.indexOf(jobId);
    const to = pendingSeq.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    void reorderItem(jobId, to - from);
  };

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

  const visible = useMemo(
    () => (historyFilter === 'all' ? history : history.filter((e) => e.status === historyFilter)),
    [history, historyFilter],
  );

  return (
    <section className="page" aria-label="任务队列">
      <header className="page-head has-actions">
        <div>
          <h1>任务队列</h1>
          <p>同一时刻最多按设置的并发数同时转换，其余任务按顺序排队；等待中的可以拖动调整顺序（也可用 Alt + ↑ / ↓）。</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flex: 'none' }}>
          {paused ? (
            <Button variant="secondary" onClick={() => void resumeQueue()}>
              继续队列
            </Button>
          ) : hasLiveWork ? (
            <Button variant="secondary" onClick={() => void pauseQueue()}>
              暂停队列
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={() => void pickFiles()}>
            添加文件
          </Button>
        </div>
      </header>

      {queue?.paused ? <PausedBanner snapshot={queue} /> : null}

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
              dragging={dragId === item.jobId}
              over={overId === item.jobId && dragId !== null && dragId !== item.jobId}
              onDragStartRow={() => setDragId(item.jobId)}
              onDragEnterRow={() => setOverId(item.jobId)}
              onDropRow={() => {
                if (dragId && dragId !== item.jobId) moveFrom(dragId, item.jobId);
                setDragId(null);
                setOverId(null);
              }}
              onDragEndRow={() => {
                setDragId(null);
                setOverId(null);
              }}
              onMoveStep={(delta) => void reorderItem(item.jobId, delta)}
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

      {/* 失败与取消也进历史（TODO-07），所以要能按结局筛 —— 否则找一条失败记录要在成功记录里翻 */}
      {history.length > 0 ? (
        <div className="history-filter">
          <div className="segmented" role="group" aria-label="历史筛选">
            {HISTORY_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={historyFilter === f.key}
                onClick={() => setHistoryFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {visible.length > 0 ? (
        <div className="queue-list">
          {visible.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </div>
      ) : history.length > 0 ? (
        <div className="empty-block is-inline">
          <p>这个筛选下还没有记录</p>
        </div>
      ) : (
        <EmptyHistory />
      )}
    </section>
  );
}
