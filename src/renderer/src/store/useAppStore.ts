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
import { CONTAINERS } from '../../../shared/containers';
import type {
  Capabilities,
  ContainerKey,
  JobError,
  JobResult,
  JobSnapshot,
  MediaMeta,
  PlanResult,
  ProgressPayload,
  Settings,
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

interface AppState {
  /* ── 导航 ─────────────────────────────── */
  page: Page;

  /* ── 转换页 ───────────────────────────── */
  stage: Stage;
  meta: MediaMeta | null;
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

  /* ── 应用级 ───────────────────────────── */
  settings: Settings | null;
  caps: Capabilities | null;
  toasts: ToastItem[];

  /* ── 动作 ─────────────────────────────── */
  init: () => Promise<void>;
  recheckCaps: () => Promise<void>;
  setPage: (page: Page) => void;
  pickFile: () => Promise<void>;
  loadFromPath: (path: string) => Promise<void>;
  setTarget: (target: ContainerKey) => Promise<void>;
  chooseOutputDir: () => Promise<void>;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  tryAnotherFormat: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  copyDiagnostics: () => Promise<void>;
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

let toastSeq = 0;
/** init 只允许跑一次：StrictMode 在开发态会双调用 effect，重复订阅会让每条 toast 弹两遍 */
let booted = false;

export const useAppStore = create<AppState>((set, get) => ({
  page: 'convert',

  stage: 'empty',
  meta: null,
  thumb: null,
  target: 'mp4',
  plan: null,
  outputPath: '',
  outputDir: null,
  progress: null,
  result: null,
  error: null,
  busy: false,

  settings: null,
  caps: null,
  toasts: [],

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

    // 进度与终态由主进程推送。这里只订阅一次，组件卸载不取消（应用级订阅）
    window.api.onProgress((progress) => set({ progress }));

    window.api.onState((snapshot: JobSnapshot) => {
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
    set({ page });
  },

  pickFile: async () => {
    if (get().busy) return;
    try {
      const { path } = await call(window.api.selectVideo());
      if (!path) return;
      await get().loadFromPath(path);
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  loadFromPath: async (path) => {
    if (!isVideoPath(path)) {
      const ext = extOf(path);
      get().toast(
        `这个文件不是视频${ext ? `（.${ext}）` : ''}，换一个视频文件试试`,
        'warning',
      );
      return;
    }
    if (get().stage !== 'empty') {
      get().toast('当前已有一个文件，请先点击「更换」', 'warning');
      return;
    }

    set({ stage: 'probing', busy: true });

    try {
      const meta = await call(window.api.probe(path));
      const { plan, outputPath } = await call(
        window.api.preview(meta, get().target, get().outputDir),
      );

      set({ meta, plan, outputPath, stage: 'setup', busy: false, thumb: null });
      get().toast(`已载入 ${meta.fileName}`, 'success');

      // 缩略图是「锦上添花」，失败不影响任何流程
      window.api
        .thumbnail(path, Math.min(2, Math.max(0, meta.durationSec / 3)))
        .then((res) => {
          if (res.ok && res.data.dataUrl) set({ thumb: res.data.dataUrl });
        })
        .catch(() => {});
    } catch (err) {
      set({ stage: 'empty', busy: false, meta: null });
      get().toast(messageOf(err), 'error');
    }
  },

  setTarget: async (target) => {
    const { meta, target: current, outputDir } = get();
    if (current === target) return;
    set({ target });

    if (!meta) return;
    try {
      const { plan, outputPath } = await call(window.api.preview(meta, target, outputDir));
      // 期间用户可能又切了格式，只接受最后一次
      if (get().target !== target) return;
      set({ plan, outputPath });
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  chooseOutputDir: async () => {
    try {
      const { path } = await call(window.api.selectOutputDir());
      if (!path) return;

      set({ outputDir: path });
      // 立刻用新目录重算输出路径，避免「输入框显示 A，实际写到 B」
      const { meta, target } = get();
      if (meta) {
        const { plan, outputPath } = await call(window.api.preview(meta, target, path));
        set({ plan, outputPath });
      }
      get().toast('已切换输出位置', 'success');
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  start: async () => {
    const { meta, target, outputDir, stage, busy } = get();
    if (!meta || stage !== 'setup' || busy) return;

    set({ busy: true, progress: null, result: null, error: null });
    try {
      const started = await call(window.api.start(meta, target, outputDir));
      // 主进程可能因为同名冲突换了个文件名，以它返回的为准
      set({
        stage: 'running',
        outputPath: started.outputPath,
        plan: started.plan,
        busy: false,
      });
    } catch (err) {
      set({ busy: false });
      get().toast(messageOf(err), 'error');
    }
  },

  cancel: async () => {
    try {
      await call(window.api.cancel());
      // 真正的状态切换等主进程推 cancelled，避免 UI 先跑一步造成状态撕裂
    } catch (err) {
      get().toast(messageOf(err), 'error');
    }
  },

  reset: () => {
    const { target } = get();
    set({
      stage: 'empty',
      meta: null,
      thumb: null,
      plan: null,
      outputPath: '',
      outputDir: null,
      progress: null,
      result: null,
      error: null,
      busy: false,
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
 * （`__appStore.getState().loadFromPath('...')`），给各个状态截图核对 UI。
 * 生产构建里 `import.meta.env.DEV` 为 false，这段不会执行。
 */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__appStore = useAppStore;
}
