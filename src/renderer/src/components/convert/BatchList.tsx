/**
 * 待转换批次列表（转换页，仅在批次 ≥ 2 时出现）。
 *
 * 三个设计决定：
 *   1. **每行显示自己的判定**：同一批里第 1 个可能直通、第 7 个需要重压缩，
 *      只标一个「全部转为 MP4」会让用户以为都很快。
 *   2. **不显示编码器名字**：与文件卡同一口径，界面上不出现 h264 / vp9 这类词。
 *   3. **移除按钮逐行给出**：批次里挑错的场景比想象中常见（拖进来一个不想转的）。
 *
 * TODO-20：这一块同时服务于音频提取。判定用 `entryMode()` 取而不是直接读 `plan`，
 * 音频条目没有 `plan`，靠它才能和视频条目走同一套汇总口径。
 */
import type { ReactElement } from 'react';
import { MAX_BATCH_TOTAL } from '../../../../shared/batch';
import { CONTAINERS } from '../../../../shared/containers';
import { AUDIO_FORMATS } from '../../../../shared/audio';
import type { AudioFormat, ContainerKey, ConversionMode } from '../../../../shared/types';
import { fmtDur, fmtSize } from '../../lib/format';
import { entryMode, entrySeconds, type BatchEntry, type OutputKind } from '../../store/useAppStore';

const MODE_LABEL: Record<ConversionMode, string> = {
  copy: '直通',
  remux: '混合直通',
  transcode: '重压缩',
};

interface BatchListProps {
  entries: BatchEntry[];
  target: ContainerKey;
  /** 输出类型（TODO-20）：音频提取时整块的文案与汇总口径都不同 */
  kind: OutputKind;
  audioFormat: AudioFormat;
  /** 探测中：整块降透明度并禁用移除，避免动到正在写入的列表 */
  busy: boolean;
  onRemove: (path: string) => void;
}

export function BatchList({
  entries,
  target,
  kind,
  audioFormat,
  busy,
  onRemove,
}: BatchListProps): ReactElement {
  const audio = kind === 'audio';
  const goal = audio ? AUDIO_FORMATS[audioFormat].label : CONTAINERS[target].label;

  return (
    <div className={`batch-card${busy ? ' is-busy' : ''}`}>
      <div className="batch-head">
        <span className="b-title">
          {audio ? `待提取 ${entries.length} 个文件的音频` : `待转换 ${entries.length} 个视频`}
        </span>
        <span className="b-sub">
          {audio ? '全部提取为' : '全部转为'} {goal} · 上限 {MAX_BATCH_TOTAL} 个
        </span>
      </div>

      <ul className="batch-rows">
        {entries.map((entry, index) => {
          const meta = entry.meta;
          const mode = entryMode(entry);
          return (
            <li className="batch-row" key={meta.path}>
              <span className="b-idx">{index + 1}</span>
              <div className="b-body">
                <div className="b-name" title={meta.path}>
                  {meta.fileName}
                </div>
                <div className="b-meta">
                  {fmtSize(meta.sizeBytes)} · {fmtDur(meta.durationSec)}
                  {mode ? <span className={`b-mode is-${mode}`}>{MODE_LABEL[mode]}</span> : null}
                </div>
              </div>
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() => onRemove(meta.path)}
              >
                移除
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 批量判定条：批次 ≥ 2 时替代单个文件的判定条。
 *
 * 为什么不直接显示第一条的判定：那会让用户以为整批都是「无损直通、预计 2 秒」，
 * 实际里面可能有 6 个要重压缩。这里给的是**汇总**——各模式各几个、总共多久。
 */
export function BatchSummary({
  entries,
  target,
  kind,
  audioFormat,
}: {
  entries: BatchEntry[];
  target: ContainerKey;
  kind: OutputKind;
  audioFormat: AudioFormat;
}): ReactElement {
  const audio = kind === 'audio';
  const goal = audio ? AUDIO_FORMATS[audioFormat].label : CONTAINERS[target].label;

  const counts: Record<ConversionMode, number> = { copy: 0, remux: 0, transcode: 0 };
  let totalSec = 0;
  for (const entry of entries) {
    const mode = entryMode(entry);
    if (mode) counts[mode] += 1;
    totalSec += entrySeconds(entry);
  }

  const parts = (['copy', 'remux', 'transcode'] as ConversionMode[])
    .filter((mode) => counts[mode] > 0)
    .map((mode) => `${MODE_LABEL[mode]} ${counts[mode]} 个`);

  return (
    <div className="batch-banner">
      <span className="bb-ico">
        <span className="bb-count">{entries.length}</span>
      </span>
      <div className="bb-body">
        <div className="bb-title">
          共 {entries.length} {audio ? '个文件' : '个视频'} →{' '}
          {audio ? '全部提取为' : '全部转为'} {goal}
        </div>
        <div className="bb-desc">
          逐个判定：{parts.join(' · ')}
          {totalSec > 0 ? ` · 预计共约 ${Math.max(1, Math.round(totalSec))} 秒` : ''}
          <br />
          {audio ? '提取' : '转换'}按顺序执行，进度与失败处理在「任务队列」里查看
        </div>
      </div>
    </div>
  );
}
