/**
 * 设置持久化。
 *
 * 只存几 KB 的非敏感配置（窗口偏好、默认输出位置、预设档位），
 * 不需要数据库，也不该进主进程之外的任何地方。
 */
import Store from 'electron-store';
import { CONTAINER_ORDER } from '../shared/containers';
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
  presets: defaultPresets(),
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
  };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings(), ...patch };
  store.set('settings', next);
  return next;
}
