/**
 * 设置持久化。
 *
 * 只存几 KB 的非敏感配置（窗口偏好、默认输出位置、预设档位），
 * 不需要数据库，也不该进主进程之外的任何地方。
 */
import Store from 'electron-store';
import { CONTAINER_ORDER } from '../shared/containers';
import { DEFAULT_TEMPLATE } from '../shared/outputName';
import { clampConcurrency } from '../shared/queue';
import type { ContainerKey, PresetTier, Settings } from '../shared/types';

function defaultPresets(): Record<ContainerKey, PresetTier> {
  const out = {} as Record<ContainerKey, PresetTier>;
  for (const key of CONTAINER_ORDER) out[key] = 'standard';
  return out;
}

export const DEFAULT_SETTINGS: Settings = {
  // null = 源文件同级（需求 M-05）。原型里写的 C:\Users\Public\Videos 是演示数据。
  defaultSavePath: null,
  defaultOutputFormat: 'mp4',
  openFolderAfterDone: true,
  density: 'normal',
  theme: 'light',
  presets: defaultPresets(),
  // 精细调节默认全关：配过的格式才按手工参数走，其余与三档行为完全一致
  quality: {},
  // 默认模板就是 MVP 的文件名规则，老用户升级后产出文件名不变
  naming: { template: DEFAULT_TEMPLATE, conflict: 'rename' },
  // 默认「共用全局参数」+「失败继续」：这两条是打扰最小的组合
  queueMode: 'shared',
  failurePolicy: 'continue',
  // 转完弹一条汇总通知：批量是「设好就走」的场景，不通知就只能靠回来看看
  notifyOnFinish: true,
  // 默认仍是串行（TODO-10）：并发是用户主动要的加速，不是升级送的
  concurrency: 1,
  // 关窗最小化到托盘继续转（TODO-14）；关掉则回到「关窗即退出」
  closeToTray: true,
  // 强杀后重启恢复未完成任务（TODO-12）；正常退出不会留下待恢复的队列
  restoreQueue: true,
};

interface Schema {
  settings: Settings;
}

const store = new Store<Schema>({
  name: 'settings',
  defaults: { settings: DEFAULT_SETTINGS },
});

/** 读取时把缺失字段补成默认值，避免旧版本配置文件把新代码带崩 */
export function getSettings(): Settings {
  const saved = store.get('settings') as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    presets: { ...defaultPresets(), ...(saved?.presets ?? {}) },
    quality: { ...(saved?.quality ?? {}) },
    naming: { ...DEFAULT_SETTINGS.naming, ...(saved?.naming ?? {}) },
    theme: saved?.theme ?? DEFAULT_SETTINGS.theme,
    // 并发数按 1–4 钳住：配置文件被手改坏过也不至于让调度器跑飞
    concurrency: clampConcurrency(saved?.concurrency),
    // 三个布尔值用显式判定而不是展开：undefined 会盖掉默认值，null 也会
    notifyOnFinish: saved?.notifyOnFinish ?? DEFAULT_SETTINGS.notifyOnFinish,
    closeToTray: saved?.closeToTray ?? DEFAULT_SETTINGS.closeToTray,
    restoreQueue: saved?.restoreQueue ?? DEFAULT_SETTINGS.restoreQueue,
  };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings(), ...patch };
  store.set('settings', next);
  return next;
}
