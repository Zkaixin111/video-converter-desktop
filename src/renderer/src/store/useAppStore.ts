/**
 * 全局状态（Zustand）。
 *
 * 职责边界：
 *   · 只做「UI 状态 + IPC 调用编排」，不做任何业务判定
 *     （能直通还是重编码、输出文件名怎么取，全部由主进程的 planner / outputPath 决定）
 *   · 主进程推送的 progress / state 事件在这里合并成单一事实来源，
 *     页面组件只读状态、不各自持有副本（避免进度条和队列页数字不一致）
 */
import { create } from 'zustand';
import { limitAdd, limitMessage } from '../../../shared/batch';
import { CONTAINERS } from '../../../shared/containers';
import type {
  Capabilities,
  ContainerKey,
  HistoryItem,
  HistoryStatus,
  JobError,
  JobResult,
  JobSnapshot,
  MediaMeta,
  PlanResult,
  PresetTier,
  ProgressPayload,
  QueueSnapshot,
  Settings,
  TaskParams,
} from '../../../shared/types';
import { call, detailOf, messageOf } from '../lib/api';

export type Page = 'convert' | 'queue' | 'presets' | 'settings' | 'about';

/** 转换页的 5 个阶段，与原型 state.stage 一一对应（多一个 probing） */
export type Stage = 'empty' | 'probing' | 'setup' | 'running' | 'done' | 'error';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

/**
 * 待转换批次里的一条。
 *
 * 连同 `plan` / `outputPath` 一起缓存的原因：转换页要逐条显示「这条会直通还是重压缩」，
 * 统一目标格式一改，所有条目的判定与输出路径都要跟着重算——缓存下来才不用在渲染里算。
 */
export interface BatchEntry {
  meta: MediaMeta;
  plan: PlanResult | null;
  outputPath: string;
  /** 磁盘预检：这条预计要写多少 / 目标位置还剩多少（TODO-03） */
  requiredBytes: number;
  freeBytes: number | null;
}

interface AppState {
  /* ── 导航 ─────────────────────────────── */
  page: Page;

  /* ── 转换页 ───────────────────────────── */
  stage: Stage;
  meta: MediaMeta | null;
  /**
   * 待转换批次（批量转换的组装区）。
   *
   * 不变量：非空时 `batch[0]` 与上面的 `meta / plan / outputPath` 同源。
   * 保留 `meta` 三件套是因为单文件视图、进度面板、结果卡、诊断信息都在读它们——
   * 让 batch[0] 兼职「主文件」，改造量最小，也不会出现两套主文件。
   */
  batch: BatchEntry[];
  thumb: string | null;
  target: ContainerKey;
  plan: PlanResult | null;
  /** 当前输出文件的完整路径（主进程算好的，UI 只展示） */
  outputPath: string;
  /** 用户手动改过输出目录；null 表示「源文件同级」 */
  outputDir: string | null;
  progress: ProgressPayload | null;
  result: JobResult | null;
  error: JobError | null;
  /** 探测中 / 启动中，用于禁用按钮防连点 */
  busy: boolean;
  /** 转换页自己那个任务（队列里可能还有别人）：状态事件按它过滤 */
  myJobId: string | null;

  /* ── 应用级 ───────────────────────────── */
  settings: Settings | null;
  caps: Capabilities | null;
  toasts: ToastItem[];
  /** 转换历史（主进程持久化，最新在前）；成功/失败/取消都在里面（TODO-07） */
  history: HistoryItem[];
  /** 队列快照（主进程推送，含排队中的任务与暂停状态） */
  queue: QueueSnapshot | null;

  /* ── 动作 ─────────────────────────────── */
  init: () => Promise<void>;
  recheckCaps: () => Promise<void>;
  setPage: (page: Page) => void;
  /** 队列页的「添加文件」：多选对话框，选完直接入队（1 个也走这条路） */
  pickFiles: () => Promise<void>;
  /** 转换页：打开文件对话框并把选中的视频加入待转换批次 */
  pickIntoBatch: (multi: boolean) => Promise<void>;
  /** 拖拽 / 对话框的共同落点：探测 + 按上限加入批次 */
  addToBatch: (paths: string[]) => Promise<void>;
  /** 从待转换批次里移除一条 */
  removeBatchItem: (path: string) => Promise<void>;
  /** 队列页直通入队（不经过转换页的批次组装） */
  enqueuePaths: (paths: string[]) => Promise<void>;
  setTarget: (target: ContainerKey) => Promise<void>;
  chooseOutputDir: () => Promise<void>;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  tryAnotherFormat: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  loadHistory: () => Promise<void>;
  removeHistory: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  /** 一键重跑：按记录里的原参数重新入队（TODO-07） */
  rerunHistory: (id: string) => Promise<void>;
  /** 历史列表的筛选（TODO-07） */
  historyFilter: HistoryStatus | 'all';
  setHistoryFilter: (filter: HistoryStatus | 'all') => void;
  /* 队列 */
  refreshQueue: () => Promise<void>;
  /** 返回是否成功：编辑器据此决定要不要关闭面板 */
  updateQueueItem: (jobId: string, custom: TaskParams | null) => Promise<boolean>;
  cancelQueueItem: (jobId: string) => Promise<void>;
  removeQueueItem: (jobId: string) => Promise<void>;
  retryQueueItem: (jobId: string) => Promise<void>;
  resumeQueue: () => Promise<void>;
  copyDiagnostics: () => Promise<void>;
  /** 打开日志所在目录（TODO-11） */
  openLogs: () => Promise<void>;
  /** 导出诊断包并在资源管理器里定位（TODO-11） */
  exportDiagnostics: () => Promise<void>;
  toast: (message: string, type?: ToastType) => void;
  dismissToast: (id: number) => void;
}

/** 支持的视频扩展名：拖入 .txt 这类文件在渲染层就拦掉，不必等 ffprobe 报错 */
const VIDEO_EXTS = [
  'mp4',
  'mkv',
  'avi',
  'mov',
  'flv',
  'wmv',
  'webm',
  'mpg',
  'mpeg',
  'm4v',
  'ts',
  'm2ts',
  'rmvb',
  'rm',
  '3gp',
  'ogv',
  'asf',
  'vob',
  'f4v',
];

function extOf(filePath: string): string {
  const m = /\.([^.\\/]+)$/.exec(filePath);
  return m ? m[1].toLowerCase() : '';
}

function isVideoPath(filePath: string): boolean {
  return VIDEO_EXTS.includes(extOf(filePath));
}

/**
 * 取某个容器的画质档位。
 * 设置还没读到时按 standard —— 与主进程的缺省一致，避免首帧判定条闪一下。
 */
function presetFor(settings: Settings | null, target: ContainerKey): PresetTier {
  return settings?.presets?.[target] ?? 'standard';
}

/** 从路径取文件名（仅用于提示文案，不参与任何判定） */
function fileNameOf(filePath: string): string {
  const m = /[^\\/]+$/.exec(filePath);
  return m ? m[0] : filePath;
}

/**
 * 探测 + 按「统一目标格式」算出判定与输出路径。
 *
 * 每个条目都要有自己的 plan：批量里第 3 个文件可能是直通、第 7 个需要重压缩，
 * 列表上要能逐条标出来，不能整批只显示主文件的判定。
 */
async function probeOne(
  path: string,
  target: ContainerKey,
  outputDir: string | null,
  settings: Settings | null,
): Promise<BatchEntry> {
  const meta = await call(window.api.probe(path));
  const { plan, outputPath, disk } = await call(
    window.api.preview(meta, target, outputDir, presetFor(settings, target)),
  );
  return {
    meta,
    plan,
    outputPath,
    requiredBytes: disk.requiredBytes,
    freeBytes: disk.freeBytes,
  };
}

/**
 * 整批的磁盘账：预估值求和，可用空间取任意一条查到的值（同一输出位置）。
 *
 * 单独看每个文件都够用，加在一起不够 —— 这正是批量场景要拦的情况。
 */
export function batchDiskUsage(
  batch: BatchEntry[],
): { required: number; free: number | null; short: number; enough: boolean } {
  const required = batch.reduce((sum, e) => sum + e.requiredBytes, 0);
  const free = batch.find((e) => e.freeBytes !== null)?.freeBytes ?? null;
  const short = free === null ? 0 : Math.max(0, required - free);
  return { required, free, short, enough: short === 0 };
}

/** 缩略图是「锦上添花」：失败不影响任何流程，所以不 await、不抛错 */
function fetchThumb(entry: BatchEntry, apply: (url: string) => void): void {
  window.api
    .thumbnail(entry.meta.path, Math.min(2, Math.max(0, entry.meta.durationSec / 3)))
    .then((res) => {
      if (res.ok && res.data.dataUrl) apply(res.data.dataUrl);
    })
    .catch(() => {});
}

let toastSeq = 0;
/** init 只允许跑一次：StrictMode 在开发态会双调用 effect，重复订阅会让每条 toast 弹两遍 */
let booted = false;

export const useAppStore = create<AppState>((set, get) => ({
  page: 'convert',

  stage: 'empty',
  meta: null,
  batch: [],
  thumb: null,
  target: 'mp4',
  plan: null,
  outputPath: '',
  outputDir: null,
  progress: null,
  result: null,
  error: null,
  busy: false,
  myJobId: null,

  settings: null,
  caps: null,
  toasts: [],
  history: [],
  historyFilter: 'all',
  queue: null,

  /** 启动一次性初始化：读自检结果与设置、订阅主进程事件 */
  init: async () => {
    if (booted) return;
    booted = true;

    try {
      const caps = await call(window.api.capabilities());
      set({ caps });
    } catch {
      /* 自检失败不应挡住界面，引导态由 caps.ffmpeg.ok === false 体现 */
    }

    try {
      const settings = await call(window.api.getSettings());
      set({
        settings,
        target: settings.defaultOutputFormat,
        // 设置里的默认保存位置就是初始输出目录；null 表示源文件同级
        outputDir: settings.defaultSavePath,
      });
    } catch {
      /* 设置读不到就用默认值，转换仍可进行 */
    }

    // 历史是独立文件，读失败也只是空列表（主进程已兜底），不阻塞启动
    void get().loadHistory();
    void get().refreshQueue();

    // 队列结构变化由主进程整体推送：入队、状态流转、暂停/继续都用这一条
    window.api.onQueue((snapshot) => set({ queue: snapshot }));

    // 进度只认「转换页自己那个任务」：队列里别的任务的进度不该改转换页的进度条
    window.api.onProgress((progress) => {
      if (progress.jobId !== get().myJobId) return;
      set({ progress });
    });

    window.api.onState((snapshot: JobSnapshot) => {
      const { myJobId, meta } = get();
      // 终态事件可能来自队列里别的任务，也可能来自用户已经「更换」掉的旧任务：
      // 只要不是当前转换页自己的 jobId，就与这一页无关。
      if (!myJobId || snapshot.jobId !== myJobId || !meta) return;

      switch (snapshot.status) {
        case 'done': {
          set({
            stage: 'done',
            result: snapshot.result ?? null,
            error: null,
            progress: null,
            busy: false,
          });
          get().toast('转换完成', 'success');
          // 主进程在终态回调里落了历史，这里刷新列表
          void get().loadHistory();
          void get().refreshQueue();
          // 「完成后打开文件夹」是设置页真实生效的开关之一
          if (get().settings?.openFolderAfterDone && snapshot.result) {
            void window.api.openFolder(snapshot.result.outputPath);
          }
          break;
        }
        case 'error':
          set({
            stage: 'error',
            error: snapshot.error ?? { code: 'E_UNKNOWN', message: '转换失败。' },
            progress: null,
            busy: false,
          });
          get().toast('转换失败', 'error');
          break;
        case 'cancelled':
          set({ stage: 'setup', progress: null, busy: false });
          get().toast('已取消转换', 'info');
          break;
        default:
          // preparing / running 的进度由 onProgress 负责，这里不重复写
          break;
      }
    });
  },

  /** 引导态里的「重新检测」：强制重新探测 ffmpeg（绕过 paths.ts 的缓存） */
  recheckCaps: async () => {
    try {
      const caps = await call(window.api.capabilities(true));
      set({ caps });
      if (caps.ffmpeg.ok) get().toast('已检测到转换组件', 'success');
      else get().toast('仍未找到转换组件，请确认文件已放到位', 'warning');
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  setPage: (page) => {
    const { stage } = get();
    // 转换中离开转换页：给提示，任务继续在后台跑（与原型一致）
    if (stage === 'running' && page !== 'convert') {
      get().toast('转换正在后台进行，可回到转换页查看进度', 'info');
    }
    if (page === 'queue') void get().refreshQueue();
    set({ page });
  },

  /** 转换页：打开对话框并加入待转换批次（单选 / 多选共用一个落点） */
  pickIntoBatch: async (multi) => {
    if (get().busy) return;
    try {
      const { paths } = await call(window.api.selectVideo(multi));
      if (paths.length === 0) return;
      await get().addToBatch(paths);
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  /**
   * 多选入口（队列页「添加文件」）。
   *
   * 与转换页的区别：队列页是**执行区**，选完直接入队，不经过批次组装。
   * 转换页是组装区，要先把文件攒成一个批次、统一目标格式，再一起开始。
   */
  pickFiles: async () => {
    if (get().busy) return;
    try {
      const { paths } = await call(window.api.selectVideo(true));
      if (paths.length === 0) return;
      await get().enqueuePaths(paths);
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  /**
   * 把文件加入待转换批次。
   *
   * 三条要点：
   *   1. **先算上限再探测**：15 个文件只探测前 10 个，不为被拒的文件白跑一次 ffprobe
   *   2. **上限提示优先于成功提示**：超限时用户更需要知道「为什么只进来 5 个」
   *   3. **不覆盖已有批次**：单个添加与批量添加是同一套累加逻辑，
   *      所以「加入下一个视频」与「一次选多个」行为天然一致
   */
  addToBatch: async (paths) => {
    if (get().busy) return;

    const stage = get().stage;
    if (stage === 'running' || stage === 'probing') {
      get().toast('当前还有任务在读取或转换，等它结束或先取消再添加', 'warning');
      return;
    }

    const videos = paths.filter(isVideoPath);
    const skipped = paths.length - videos.length;
    if (videos.length === 0) {
      get().toast('这些不是视频文件，换一个视频试试', 'warning');
      return;
    }

    // done / error 阶段再添加 = 开始新一批（旧文件已结束，结果在历史里）
    const base = stage === 'done' || stage === 'error' ? [] : get().batch;
    const limit = limitAdd(videos, base.length);
    const notice = limitMessage(limit, base.length);

    if (limit.accepted.length === 0) {
      if (notice) get().toast(notice, 'warning');
      return;
    }

    const wasEmpty = stage === 'empty';
    set({ busy: true, ...(wasEmpty ? { stage: 'probing' as Stage } : {}) });

    try {
      const { target, outputDir, settings } = get();
      const added: BatchEntry[] = [];
      for (const path of limit.accepted) {
        try {
          added.push(await probeOne(path, target, outputDir, settings));
        } catch (err) {
          get().toast(`${fileNameOf(path)} 读取失败：${messageOf(err)}`, 'warning');
        }
      }

      if (added.length === 0) {
        set({ busy: false, ...(wasEmpty ? { stage: 'empty' as Stage } : {}) });
        return;
      }

      const next = [...base, ...added];
      const primary = next[0];
      const primaryChanged = base[0]?.meta.path !== primary.meta.path;

      set({
        batch: next,
        meta: primary.meta,
        plan: primary.plan,
        outputPath: primary.outputPath,
        stage: 'setup',
        busy: false,
        error: null,
        result: null,
        thumb: primaryChanged ? null : get().thumb,
      });

      if (primaryChanged) fetchThumb(primary, (url) => set({ thumb: url }));

      if (notice) {
        get().toast(notice, 'warning');
      } else if (skipped > 0) {
        get().toast(`已加入 ${added.length} 个视频（跳过 ${skipped} 个非视频文件）`, 'success');
      } else if (added.length === 1) {
        get().toast(`已加入 ${added[0].meta.fileName}`, 'success');
      } else {
        get().toast(`已加入 ${added.length} 个视频`, 'success');
      }
    } catch (err) {
      set({ busy: false, ...(wasEmpty ? { stage: 'empty' as Stage } : {}) });
      get().toast(messageOf(err), 'error');
    }
  },

  /** 从批次里移除一条；移除主文件时由下一条顶上，并重取缩略图 */
  removeBatchItem: async (path) => {
    const { batch } = get();
    const next = batch.filter((e) => e.meta.path !== path);
    if (next.length === 0) {
      get().reset();
      return;
    }

    const primary = next[0];
    const primaryChanged = batch[0]?.meta.path !== primary.meta.path;
    set({
      batch: next,
      meta: primary.meta,
      plan: primary.plan,
      outputPath: primary.outputPath,
      thumb: primaryChanged ? null : get().thumb,
    });
    if (primaryChanged) fetchThumb(primary, (url) => set({ thumb: url }));
    get().toast(`已移除 ${fileNameOf(path)}`, 'info');
  },

  /**
   * 队列页直通入队。
   *
   * 队列是执行区，不限制自身长度（任务会随着完成离开队列），
   * 但**单次**添加同样受 10 个上限约束 —— 拖 50 个文件进来一次性压进队列没有意义。
   */
  enqueuePaths: async (paths) => {
    if (get().busy) return;

    const videos = paths.filter(isVideoPath);
    const skipped = paths.length - videos.length;
    if (videos.length === 0) {
      get().toast('拖入的不是视频文件，换一个试试', 'warning');
      return;
    }

    const limit = limitAdd(videos, 0);
    const notice = limitMessage(limit, 0);
    if (limit.accepted.length === 0) {
      if (notice) get().toast(notice, 'warning');
      return;
    }

    // 单任务独立参数模式：新任务自带当前面板的格式与档位（之后可单独编辑）
    const { settings, target, outputDir } = get();
    const perTask = (settings?.queueMode ?? 'shared') === 'per-task';
    const custom: TaskParams | null = perTask
      ? { target, preset: presetFor(settings, target) }
      : null;

    set({ busy: true });
    try {
      const inputs = [];
      for (const path of limit.accepted) {
        try {
          const meta = await call(window.api.probe(path));
          inputs.push({ meta, globalTarget: target, custom });
        } catch (err) {
          get().toast(`${fileNameOf(path)} 读取失败：${messageOf(err)}`, 'warning');
        }
      }
      if (inputs.length === 0) {
        set({ busy: false });
        return;
      }

      const items = await call(window.api.enqueue(inputs, outputDir));
      set({ busy: false, page: 'queue' });
      void get().refreshQueue();

      if (notice) {
        get().toast(notice, 'warning');
      } else {
        get().toast(
          `已加入队列：${items.length} 个文件${skipped > 0 ? `（跳过 ${skipped} 个非视频）` : ''}`,
          'success',
        );
      }
    } catch (err) {
      set({ busy: false });
      get().toast(messageOf(err), 'error');
    }
  },

  /**
   * 切换统一目标格式。
   *
   * 批量的关键是**所有条目一起重算**：格式从 MP4 换成 WebM，
   * 每条的输出扩展名、判定结果（直通还是重压缩）、预计耗时都会变，
   * 只更新主文件会出现「列表里还写着 .mp4」的错位。
   */
  setTarget: async (target) => {
    const { batch, target: current, outputDir, settings } = get();
    if (current === target) return;
    set({ target });

    if (batch.length === 0) return;
    try {
      const preset = presetFor(settings, target);
      const next = await Promise.all(
        batch.map(async (entry) => {
          const { plan, outputPath, disk } = await call(
            window.api.preview(entry.meta, target, outputDir, preset),
          );
          return {
            ...entry,
            plan,
            outputPath,
            requiredBytes: disk.requiredBytes,
            freeBytes: disk.freeBytes,
          };
        }),
      );
      // 期间用户可能又切了格式，只接受最后一次
      if (get().target !== target) return;
      const primary = next[0];
      set({ batch: next, plan: primary.plan, outputPath: primary.outputPath });
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  chooseOutputDir: async () => {
    try {
      const { path } = await call(window.api.selectOutputDir());
      if (!path) return;

      set({ outputDir: path });
      // 立刻用新目录重算输出路径，避免「输入框显示 A，实际写到 B」；批量要逐条重算
      const { batch, target, settings } = get();
      if (batch.length > 0) {
        const preset = presetFor(settings, target);
        const next = await Promise.all(
          batch.map(async (entry) => {
            const { plan, outputPath, disk } = await call(
              window.api.preview(entry.meta, target, path, preset),
            );
            return {
              ...entry,
              plan,
              outputPath,
              requiredBytes: disk.requiredBytes,
              freeBytes: disk.freeBytes,
            };
          }),
        );
        const primary = next[0];
        set({ batch: next, plan: primary.plan, outputPath: primary.outputPath });
      }
      get().toast('已切换输出位置', 'success');
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  /**
   * 开始转换。
   *
   * 分批处理两种规模，因为它们的「观察位置」不同：
   *   · 1 个文件 → 留在转换页看进度（原有单文件流程，一行未改）
   *   · 2 个及以上 → 整批入队后跳到任务队列页
   *     一次跑 10 个任务时，转换页那张单条进度卡说不清「还剩几个」，
   *     而队列页本来就有逐条进度与失败处理，没有必要再实现第二套。
   */
  start: async () => {
    const { batch, target, outputDir, stage, busy, settings } = get();
    if (batch.length === 0 || stage !== 'setup' || busy) return;

    // 单任务独立参数模式：把当前面板的格式与档位固化到任务上（之后可在队列里单独改）
    const perTask = (settings?.queueMode ?? 'shared') === 'per-task';
    const custom: TaskParams | null = perTask
      ? { target, preset: presetFor(settings, target) }
      : null;

    set({ busy: true, progress: null, result: null, error: null });
    try {
      const items = await call(
        window.api.enqueue(
          batch.map((entry) => ({ meta: entry.meta, globalTarget: target, custom })),
          outputDir,
        ),
      );
      if (items.length === 0) throw new Error('入队失败');

      if (items.length === 1) {
        set({
          stage: 'running',
          myJobId: items[0].jobId,
          // 主进程可能因为同名冲突换了文件名，以它返回的为准
          outputPath: items[0].outputPath,
          busy: false,
        });
        void get().refreshQueue();
        return;
      }

      // 批量：转换页清空回到空态，批次整体移交给队列
      set({
        stage: 'empty',
        batch: [],
        meta: null,
        thumb: null,
        plan: null,
        outputPath: '',
        progress: null,
        result: null,
        error: null,
        busy: false,
        myJobId: null,
        page: 'queue',
      });
      get().toast(`已加入队列：${items.length} 个视频，正在按顺序转换`, 'success');
      void get().refreshQueue();
    } catch (err) {
      set({ busy: false });
      get().toast(messageOf(err), 'error');
    }
  },

  cancel: async () => {
    try {
      const jobId = get().myJobId ?? undefined;
      await call(window.api.cancelQueueItem(jobId));
      // 真正的状态切换等主进程推 cancelled，避免 UI 先跑一步造成状态撕裂
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  reset: () => {
    const { target, stage, myJobId } = get();
    // 转换中点「更换」：先把后台任务停掉再把界面清空，
    // 否则 ffmpeg 会在用户不知情的情况下继续跑完，还往磁盘写一个文件。
    if (stage === 'running' && myJobId) void window.api.cancelQueueItem(myJobId);

    set({
      stage: 'empty',
      meta: null,
      batch: [],
      thumb: null,
      plan: null,
      outputPath: '',
      // 回到「设置里的默认保存位置」，而不是把用户改过的目录也一起忘掉
      outputDir: get().settings?.defaultSavePath ?? null,
      progress: null,
      result: null,
      error: null,
      busy: false,
      myJobId: null,
      target,
    });
  },

  tryAnotherFormat: async () => {
    const { target } = get();
    // 换一个与当前不同的格式：优先 MP4，其次 MP4 之外的第一项
    const next: ContainerKey = target === 'mp4' ? 'mkv' : 'mp4';
    set({ stage: 'setup', error: null, result: null });
    await get().setTarget(next);
    get().toast(`已切换到 ${CONTAINERS[next].label}，可以再试一次`, 'info');
  },

  updateSettings: async (patch) => {
    try {
      const settings = await call(window.api.setSettings(patch));
      set({ settings });

      // 改的是画质档位：转换页的判定条与输出参数必须立刻跟着变，
      // 否则用户会看到「预设改了但预计耗时/参数没变」的假象。
      if (patch.presets) {
        const { meta, target, stage, outputDir } = get();
        if (meta && stage === 'setup') {
          const { plan, outputPath } = await call(
            window.api.preview(meta, target, outputDir, presetFor(settings, target)),
          );
          set({ plan, outputPath });
        }
      }
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  loadHistory: async () => {
    try {
      const history = await call(window.api.listHistory());
      set({ history });
    } catch {
      /* 历史读不到就当空的，不能影响转换 */
    }
  },

  removeHistory: async (id) => {
    try {
      set({ history: await call(window.api.removeHistory(id)) });
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  clearHistory: async () => {
    try {
      await call(window.api.clearHistory());
      set({ history: [], historyFilter: 'all' });
      get().toast('已清空转换历史', 'success');
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  /**
   * 一键重跑（TODO-07）。
   *
   * 重跑一定会生成一个新 jobId —— 历史是按 jobId 幂等的，
   * 沿用旧的 id 会让「上次失败」那条记录被新结果直接覆盖掉，
   * 用户就再也查不到它失败过。
   */
  rerunHistory: async (id) => {
    try {
      await call(window.api.rerunHistory(id));
      void get().refreshQueue();
      set({ page: 'queue' });
      get().toast('已按原参数重新加入队列', 'success');
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  setHistoryFilter: (filter) => set({ historyFilter: filter }),

  /* ── 队列 ─────────────────────────────── */
  refreshQueue: async () => {
    try {
      set({ queue: await call(window.api.listQueue()) });
    } catch {
      /* 队列读不到不影响转换，主进程还会继续推事件 */
    }
  },

  updateQueueItem: async (jobId, custom) => {
    try {
      // 全局 target 一起带上：custom 为 null 时主进程要靠它回落（例如「改为跟随全局」）
      const { target } = get();
      await call(window.api.updateQueueItem(jobId, custom, target));
      void get().refreshQueue();
      get().toast(custom ? '任务参数已更新' : '该任务已改为跟随全局参数', 'success');
      return true;
    } catch (err) {
      get().toast(messageOf(err), 'error');
      return false;
    }
  },

  cancelQueueItem: async (jobId) => {
    try {
      await call(window.api.cancelQueueItem(jobId));
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  removeQueueItem: async (jobId) => {
    try {
      set({ queue: await call(window.api.removeQueueItem(jobId)) });
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  retryQueueItem: async (jobId) => {
    try {
      set({ queue: await call(window.api.retryQueueItem(jobId)) });
      get().toast('已重新加入队列', 'info');
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  resumeQueue: async () => {
    try {
      set({ queue: await call(window.api.resumeQueue()) });
      get().toast('队列已继续', 'info');
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  /** 「复制诊断信息」：拼装文本交给主进程写剪贴板（渲染层在 sandbox 下没有 clipboard 权限） */
  copyDiagnostics: async () => {
    const { meta, target, error, caps, result } = get();
    const lines = [
      `时间：${new Date().toLocaleString('zh-CN')}`,
      `文件：${meta?.fileName ?? '未知'}`,
      `路径：${meta?.path ?? '未知'}`,
      `大小：${meta ? `${(meta.sizeBytes / 1024 / 1024).toFixed(1)} MB` : '未知'}`,
      `时长：${meta ? `${meta.durationSec.toFixed(2)} 秒` : '未知'}`,
      `目标格式：${CONTAINERS[target].label}`,
      `阶段：${error ? '转换中断' : '完成'}`,
      `错误码：${error?.code ?? '—'}`,
      `输出：${result?.outputPath ?? '—'}`,
      `应用版本：v${caps?.app.version ?? '0.1.0'}`,
      `引擎版本：${caps?.ffmpeg.version ?? '未检测到'}`,
    ];
    if (error?.detail) lines.push('', '—— FFmpeg 输出（末 20 行）——', error.detail);

    try {
      await call(window.api.copyText(lines.join('\n')));
      get().toast('诊断信息已复制', 'success');
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  /** 打开日志目录：用户报问题时能一键拿到现场，不用对着 toast 截图 */
  openLogs: async () => {
    try {
      await call(window.api.openLogs());
    } catch (err) {
      get().toast(messageOf(err), 'info');
    }
  },

  /**
   * 导出诊断包（TODO-11）。
   * 导出后直接在资源管理器里选中它 —— 用户下一步就是转发给别人，
   * 让他自己去找下载到哪儿了是没必要的折磨。
   */
  exportDiagnostics: async () => {
    try {
      const { path } = await call(window.api.exportDiagnostics());
      if (!path) return;
      await call(window.api.openFolder(path));
      get().toast('诊断包已导出', 'success');
    } catch (err) {
      const msg = messageOf(err);
      // 用户在保存对话框里点了取消，这不算错误，别弹红色
      if (msg.includes('取消')) return;
      get().toast(msg, 'error');
    }
  },

  toast: (message, type = 'success') => {
    toastSeq += 1;
    const item: ToastItem = { id: toastSeq, type, message };
    set((s) => ({ toasts: [...s.toasts, item].slice(-3) }));
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** 供组件在 catch 里附上技术细节（不进 UI 主文案，只进诊断信息） */
export function detailOfError(err: unknown): string | undefined {
  return detailOf(err);
}

/**
 * 开发态把 store 挂到 window 上。
 *
 * 用途：在没有 Playwright 的环境里，用 CDP 的 Runtime.evaluate 直接驱动界面
 * （`__appStore.getState().addToBatch(['...'])`），给各个状态截图核对 UI。
 * 生产构建里 `import.meta.env.DEV` 为 false，这段不会执行。
 */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__appStore = useAppStore;
}
