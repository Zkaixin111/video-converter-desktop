/**
 * 转换页（原型 #page-convert）。
 *
 * 五种阶段互斥渲染：empty / probing → 拖拽区；setup / running / done / error → 文件卡 + 对应卡片。
 * 所有判定结果都来自主进程（planner + outputPath），这里只做展示与动作转发。
 *
 * P1 起这一页同时是「批量转换的组装区」：
 *   · 1 个文件 → 完全维持原有单文件视图（文件卡 + 判定条 + 开始转换）
 *   · 2 个及以上 → 换成批次列表 + 汇总判定条，整批共用同一个目标格式
 *   · 无论几个，「加入下一个视频 / 一次选多个」的入口都在同一位置，上限 10 个
 */
import { useMemo, useState, type ReactElement } from 'react';
import { MAX_BATCH_TOTAL } from '../../../shared/batch';
import { CONTAINERS } from '../../../shared/containers';
import { formatBytes } from '../../../shared/estimate';
import { batchDiskUsage, useAppStore } from '../store/useAppStore';
import { DropZone } from '../components/convert/DropZone';
import { MediaCard } from '../components/convert/MediaCard';
import { TargetPicker } from '../components/convert/TargetPicker';
import { PlanSummary } from '../components/convert/PlanSummary';
import { BatchList, BatchSummary } from '../components/convert/BatchList';
import { ProgressPanel } from '../components/convert/ProgressPanel';
import { ResultCard } from '../components/convert/ResultCard';
import { ErrorPanel } from '../components/convert/ErrorPanel';
import { LogDialog } from '../components/ui/LogDialog';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';

/** 转换引擎缺失时的引导态：比「按钮点了没反应」明确得多 */
function GuideCard(): ReactElement {
  const caps = useAppStore((s) => s.caps);
  const recheck = useAppStore((s) => s.recheckCaps);
  const toast = useAppStore((s) => s.toast);
  const missing = caps?.ffmpeg.missing ?? [];
  const ffmpegPath = caps?.ffmpeg.ffmpegPath ?? '';
  const dir = ffmpegPath ? ffmpegPath.replace(/[\\/][^\\/]+$/, '') : '';
  // 文件在、但缺 libx264：LGPL 精简版 ffmpeg 的典型症状，和「文件不存在」要分开说
  const noEncoder = missing.length === 0;

  return (
    <div className="card guide-card">
      <div className="guide-title">
        <Icon name="i-alert" />
        {noEncoder ? '转换组件不完整' : '缺少转换组件（FFmpeg）'}
      </div>
      <p>
        {noEncoder
          ? '已找到 FFmpeg，但它没有内置 H.264 编码器（libx264），转画面时会直接失败。请换一个完整版（full build）的 FFmpeg。'
          : '应用内置的转码引擎没有找到，暂时无法转换任何文件。请把 ffmpeg.exe 与 ffprobe.exe 放到下面的目录，然后点「重新检测」。'}
      </p>
      <div className="guide-path">
        {noEncoder ? '缺少：libx264 编码器' : `缺失：${missing.join('、')}`}
      </div>
      {dir ? <div className="guide-path">目录：{dir}</div> : null}
      <div className="guide-actions">
        {/* 直接把目录打开：让用户不用手抄一长串路径，也避免抄错盘符 */}
        {dir ? (
          <Button
            variant="secondary"
            onClick={() => {
              void window.api.openFolder(dir, true).then((res) => {
                if (!res.ok) toast(res.error.message, 'error');
              });
            }}
          >
            <Icon name="i-folder" />
            打开该目录
          </Button>
        ) : null}
        <Button variant="primary" onClick={() => void recheck()}>
          <Icon name="i-refresh" />
          重新检测
        </Button>
      </div>
    </div>
  );
}

export function ConvertPage(): ReactElement {
  const stage = useAppStore((s) => s.stage);
  const meta = useAppStore((s) => s.meta);
  const batch = useAppStore((s) => s.batch);
  const thumb = useAppStore((s) => s.thumb);
  const target = useAppStore((s) => s.target);
  const plan = useAppStore((s) => s.plan);
  const outputPath = useAppStore((s) => s.outputPath);
  const progress = useAppStore((s) => s.progress);
  const result = useAppStore((s) => s.result);
  const error = useAppStore((s) => s.error);
  const busy = useAppStore((s) => s.busy);
  const caps = useAppStore((s) => s.caps);
  const myJobId = useAppStore((s) => s.myJobId);
  const queue = useAppStore((s) => s.queue);

  const pickIntoBatch = useAppStore((s) => s.pickIntoBatch);
  const removeBatchItem = useAppStore((s) => s.removeBatchItem);
  const setTarget = useAppStore((s) => s.setTarget);
  const chooseOutputDir = useAppStore((s) => s.chooseOutputDir);
  const start = useAppStore((s) => s.start);
  const cancel = useAppStore((s) => s.cancel);
  const reset = useAppStore((s) => s.reset);
  const tryAnotherFormat = useAppStore((s) => s.tryAnotherFormat);
  const copyDiagnostics = useAppStore((s) => s.copyDiagnostics);
  const toast = useAppStore((s) => s.toast);

  /** 本次任务的日志弹层（TODO-11） */
  const [logOpen, setLogOpen] = useState(false);

  const engineMissing = caps ? !caps.ffmpeg.ok : false;
  const empty = stage === 'empty' || stage === 'probing';
  // 队列里可能还有别的任务：只认自己这个 jobId 是否已经轮到
  const myQueued = myJobId
    ? queue?.items.find((i) => i.jobId === myJobId)?.status === 'pending'
    : false;

  const count = batch.length;
  const full = count >= MAX_BATCH_TOTAL;
  const multi = count > 1;

  /**
   * 磁盘预检（TODO-03）。
   * 单个文件看着够用、整批加起来不够 —— 这正是批量场景要拦的账，
   * 所以在转换页就把整批的预估空间算好，不够直接不让开始。
   */
  const disk = useMemo(() => batchDiskUsage(batch), [batch]);

  return (
    <section className="page" aria-label="转换">
      <header className="page-head">
        <h1>转换</h1>
        <p>拖入视频文件，选择一个目标格式，我们负责让它一定能用。</p>
      </header>

      {empty ? (
        engineMissing ? (
          <GuideCard />
        ) : (
          <DropZone
            busy={stage === 'probing'}
            onPick={() => void pickIntoBatch(false)}
            onPickMany={() => void pickIntoBatch(true)}
          />
        )
      ) : null}

      {!empty && meta ? (
        <div>
          {multi ? (
            <BatchList
              entries={batch}
              target={target}
              busy={busy}
              onRemove={(p) => void removeBatchItem(p)}
            />
          ) : (
            <MediaCard meta={meta} thumb={thumb} onReplace={reset} />
          )}

          {stage === 'setup' ? (
            <div>
              {/* 加入下一个视频：单文件与批量共用同一条入口，达到上限后禁用 */}
              <div className="batch-add">
                <Button
                  variant="secondary"
                  disabled={busy || full}
                  onClick={() => void pickIntoBatch(false)}
                >
                  <Icon name="i-upload" />
                  加入下一个视频
                </Button>
                <button
                  type="button"
                  className="btn-text"
                  disabled={busy || full}
                  onClick={() => void pickIntoBatch(true)}
                >
                  一次选多个
                </button>
                <span className={`batch-add-hint${full ? ' is-full' : ''}`}>
                  {full
                    ? `已达上限 ${MAX_BATCH_TOTAL} 个，不能再添加`
                    : `已选 ${count}/${MAX_BATCH_TOTAL} 个${multi ? `，全部转为 ${CONTAINERS[target].label}` : ''}`}
                </span>
              </div>

              <div className="section-label">输出格式</div>
              <TargetPicker value={target} disabled={busy} onChange={(t) => void setTarget(t)} />

              <div className="section-label">转换方式</div>
              {multi ? <BatchSummary entries={batch} target={target} /> : <PlanSummary plan={plan} />}

              <div className="output-row">
                <span className="lbl">输出位置</span>
                <span className="path mono" title={outputPath}>
                  {outputPath || '—'}
                </span>
                <button type="button" className="btn-text" onClick={() => void chooseOutputDir()}>
                  更改
                </button>
              </div>

              {/* 空间不够时说明差多少：转一半写满盘 = 前面几个文件全白转 */}
              {disk.free !== null ? (
                <div className={`disk-row${disk.enough ? '' : ' is-short'}`}>
                  <Icon name={disk.enough ? 'i-info' : 'i-alert'} />
                  {disk.enough
                    ? `预计需要约 ${formatBytes(disk.required)}，当前位置可用 ${formatBytes(disk.free)}`
                    : `空间不足：预计需要 ${formatBytes(disk.required)}，当前可用 ${formatBytes(disk.free)}，还差 ${formatBytes(disk.short)}。请先清理或换个保存位置。`}
                </div>
              ) : null}

              <div className="action-row">
                <Button
                  variant="primary"
                  size="lg"
                  disabled={busy || !disk.enough}
                  onClick={() => void start()}
                >
                  {busy ? '正在准备…' : multi ? `开始转换 ${count} 个视频` : '开始转换'}
                </Button>
              </div>
            </div>
          ) : null}

          {stage === 'running' ? (
            <ProgressPanel
              mode={plan?.mode ?? 'transcode'}
              fileName={meta.fileName}
              outputPath={outputPath}
              progress={progress}
              queued={myQueued}
              onCancel={() => void cancel()}
            />
          ) : null}

          {stage === 'done' && result ? (
            <ResultCard
              result={result}
              onOpenFolder={() => {
                void window.api.openFolder(result.outputPath);
                toast('已打开输出文件夹', 'success');
              }}
              onAgain={reset}
            />
          ) : null}

          {stage === 'error' && error ? (
            <ErrorPanel
              error={error}
              jobId={myJobId}
              onViewLog={() => setLogOpen(true)}
              onCopyDiagnostics={() => void copyDiagnostics()}
              onTryAnother={() => void tryAnotherFormat()}
            />
          ) : null}
        </div>
      ) : null}

      {logOpen && myJobId ? (
        <LogDialog
          jobId={myJobId}
          fileName={meta?.fileName ?? ''}
          onClose={() => setLogOpen(false)}
        />
      ) : null}
    </section>
  );
}
