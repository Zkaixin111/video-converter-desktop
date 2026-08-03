/**
 * 设置页（原型 #page-settings）。
 *
 * 真生效的三项：默认保存位置、默认输出格式、完成后打开文件夹、界面密度（共四项）。
 * 主题与性能区按原型置灰并标注「后续版本」，不做假的开关。
 */
import { useState, type ReactElement } from 'react';
import { CONTAINERS, CONTAINER_ORDER } from '../../../shared/containers';
import { DEFAULT_TEMPLATE, NAMING_CONFLICTS, NAMING_TOKENS, buildTokens, renderOutputName } from '../../../shared/outputName';
import type { ConflictPolicy, ContainerKey, ThemeMode } from '../../../shared/types';
import { call, messageOf } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { Icon } from '../components/ui/Icon';

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];

const THEME_LABEL: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

const THEME_TOAST: Record<ThemeMode, string> = {
  light: '已切换到浅色主题',
  dark: '已切换到深色主题',
  system: '主题将跟随系统设置即时变化',
};

const CONFLICT_LABEL: Record<ConflictPolicy, string> = {
  rename: '自动加序号',
  overwrite: '直接覆盖',
  skip: '跳过该文件',
};

const CONFLICT_TOAST: Record<ConflictPolicy, string> = {
  rename: '重名时会自动加序号另存',
  overwrite: '重名时会覆盖已有文件',
  skip: '重名时会跳过该文件（不生成任务）',
};

export function SettingsPage(): ReactElement {
  const settings = useAppStore((s) => s.settings);
  const caps = useAppStore((s) => s.caps);
  const update = useAppStore((s) => s.updateSettings);
  const toast = useAppStore((s) => s.toast);

  const engineVersion = caps?.ffmpeg.version ?? '未检测到';

  // 模板输入框用草稿态：每敲一个键就写设置会导致整应用重算判定，
  // 而且半成品模板（比如刚删到只剩 `{`）没有意义。
  const [templateDraft, setTemplateDraft] = useState<string | null>(null);
  const currentTemplate = settings?.naming.template ?? DEFAULT_TEMPLATE;

  /** 预览用一个固定时间与假想的源文件，保证「所见即所得」且不受本机文件影响 */
  const previewName = `${renderOutputName(templateDraft ?? currentTemplate, {
    ...buildTokens({
      sourcePath: 'C:////家庭录像////家庭录像.mp4',
      targetLabel: 'MP4',
      preset: 'standard',
      index: 2,
      total: 12,
      now: new Date(2026, 9, 18, 9, 30),
    }),
  })}.mp4`;

  const commitTemplate = async (): Promise<void> => {
    if (templateDraft === null || templateDraft.trim() === currentTemplate) {
      setTemplateDraft(null);
      return;
    }
    const next = templateDraft.trim();
    const fallback = settings?.naming ?? { template: DEFAULT_TEMPLATE, conflict: 'rename' as ConflictPolicy };
    await update({ naming: { ...fallback, template: next || DEFAULT_TEMPLATE } });
    setTemplateDraft(null);
    toast(next ? '命名模板已更新' : '已恢复默认命名模板', 'success');
  };

  const resetTemplate = async (): Promise<void> => {
    const fallback = settings?.naming ?? { template: DEFAULT_TEMPLATE, conflict: 'rename' as ConflictPolicy };
    await update({ naming: { ...fallback, template: DEFAULT_TEMPLATE } });
    setTemplateDraft(null);
    toast('已恢复默认命名模板', 'info');
  };

  const pickSavePath = async (): Promise<void> => {
    try {
      const { path } = await call(window.api.selectOutputDir());
      if (!path) return;
      await update({ defaultSavePath: path });
      toast('默认保存位置已更新', 'success');
    } catch (err) {
      toast(messageOf(err), 'error');
    }
  };

  return (
    <section className="page" aria-label="设置">
      <header className="page-head">
        <h1>设置</h1>
        <p>调整默认行为与界面偏好。</p>
      </header>

      <div className="section-label">常规</div>
      <div className="setting-card">
        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">默认保存位置</div>
            <div className="s-value">{settings?.defaultSavePath ?? '源文件同级目录'}</div>
          </div>
          <button type="button" className="btn-text" onClick={() => void pickSavePath()}>
            更改
          </button>
        </div>

        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">默认输出格式</div>
            <div className="s-desc">打开转换页时默认选中的格式</div>
          </div>
          <select
            className="select"
            value={settings?.defaultOutputFormat ?? 'mp4'}
            onChange={(e) => {
              const value = e.target.value as ContainerKey;
              void update({ defaultOutputFormat: value });
              toast(`默认输出格式已设为 ${CONTAINERS[value].label}`, 'success');
            }}
          >
            {CONTAINER_ORDER.map((key) => (
              <option key={key} value={key}>
                {CONTAINERS[key].label} · {CONTAINERS[key].desc}
              </option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">转换完成后打开所在文件夹</div>
          </div>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={settings?.openFolderAfterDone ?? true}
            aria-label="转换完成后打开所在文件夹"
            onClick={() => {
              const next = !(settings?.openFolderAfterDone ?? true);
              void update({ openFolderAfterDone: next });
              toast(next ? '转换完成后会自动打开所在文件夹' : '已关闭自动打开文件夹', 'info');
            }}
          >
            <i />
          </button>
        </div>
      </div>

      <div className="section-label">输出文件</div>
      <div className="setting-card">
        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">文件命名模板</div>
            <div className="s-desc">
              可用占位符：{NAMING_TOKENS.join(' · ')}。识别不了的占位符会原样保留。
              留空或渲染结果非法时使用默认模板 {'{name}_converted'}。
            </div>
          </div>
          <input
            className="select"
            style={{ minWidth: 240 }}
            value={templateDraft ?? settings?.naming.template ?? DEFAULT_TEMPLATE}
            placeholder={DEFAULT_TEMPLATE}
            aria-label="文件命名模板"
            onChange={(e) => setTemplateDraft(e.target.value)}
            onBlur={() => void commitTemplate()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitTemplate();
            }}
          />
        </div>

        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">命名预览</div>
            <div className="s-desc">
              以「家庭录像.mp4 → MP4」为例：
              <span className="mono"> {previewName}</span>
            </div>
          </div>
          <button type="button" className="btn-text" onClick={() => void resetTemplate()}>
            恢复默认
          </button>
        </div>

        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">输出文件重名时</div>
            <div className="s-desc">
              自动加序号：另存为 xxx_1.mp4 · 直接覆盖：替换已有文件（源文件本身永远不会被覆盖） ·
              跳过：这个文件不生成任务
            </div>
          </div>
          <div className="segmented" role="group" aria-label="输出文件重名时">
            {NAMING_CONFLICTS.map((policy) => (
              <button
                key={policy}
                type="button"
                aria-pressed={(settings?.naming.conflict ?? 'rename') === policy}
                onClick={() => {
                  if ((settings?.naming.conflict ?? 'rename') === policy) return;
                  void update({ naming: { ...settings!.naming, conflict: policy } });
                  toast(CONFLICT_TOAST[policy], 'info');
                }}
              >
                {CONFLICT_LABEL[policy]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="section-label">批量队列</div>
      <div className="setting-card">
        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">输出参数模式</div>
            <div className="s-desc">
              共用全局参数：新任务跟随参数预设页的配置 ·
              单任务独立参数：每个任务可单独设定格式与档位。
              切换只影响之后新增的任务，队列里已有的任务不变。
            </div>
          </div>
          <div className="segmented" role="group" aria-label="输出参数模式">
            <button
              type="button"
              aria-pressed={(settings?.queueMode ?? 'shared') === 'shared'}
              onClick={() => {
                if (settings?.queueMode === 'shared') return;
                void update({ queueMode: 'shared' });
                toast('后续新增任务将共用全局参数', 'info');
              }}
            >
              共用全局参数
            </button>
            <button
              type="button"
              aria-pressed={settings?.queueMode === 'per-task'}
              onClick={() => {
                if (settings?.queueMode === 'per-task') return;
                void update({ queueMode: 'per-task' });
                toast('后续新增任务将各自携带参数，可在队列页单独调整', 'info');
              }}
            >
              单任务独立参数
            </button>
          </div>
        </div>

        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">任务失败后</div>
            <div className="s-desc">
              继续：跳过失败任务，接着转换后面的 ·
              暂停：整个队列停下等你处理。失败任务都会标红并记录错误日志，可单独重试或删除。
            </div>
          </div>
          <div className="segmented" role="group" aria-label="任务失败后">
            <button
              type="button"
              aria-pressed={(settings?.failurePolicy ?? 'continue') === 'continue'}
              onClick={() => {
                if (settings?.failurePolicy === 'continue') return;
                void update({ failurePolicy: 'continue' });
                toast('单个任务失败后会继续运行剩余任务', 'info');
              }}
            >
              继续运行
            </button>
            <button
              type="button"
              aria-pressed={settings?.failurePolicy === 'pause'}
              onClick={() => {
                if (settings?.failurePolicy === 'pause') return;
                void update({ failurePolicy: 'pause' });
                toast('单个任务失败后会暂停整个队列', 'info');
              }}
            >
              暂停队列
            </button>
          </div>
        </div>
      </div>

      <div className="section-label">外观</div>
      <div className="setting-card">
        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">主题</div>
            <div className="s-desc">跟随系统会随系统主题即时变化，不用重启</div>
          </div>
          <div className="segmented" role="group" aria-label="主题">
            {THEME_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={(settings?.theme ?? 'light') === mode}
                onClick={() => {
                  if ((settings?.theme ?? 'light') === mode) return;
                  void update({ theme: mode });
                  toast(THEME_TOAST[mode], 'info');
                }}
              >
                {THEME_LABEL[mode]}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">界面密度</div>
          </div>
          <div className="segmented" role="group" aria-label="界面密度">
            <button
              type="button"
              aria-pressed={(settings?.density ?? 'normal') === 'normal'}
              onClick={() => {
                void update({ density: 'normal' });
                toast('已切换为标准密度', 'info');
              }}
            >
              标准
            </button>
            <button
              type="button"
              aria-pressed={settings?.density === 'compact'}
              onClick={() => {
                void update({ density: 'compact' });
                toast('已切换为紧凑密度', 'info');
              }}
            >
              紧凑
            </button>
          </div>
        </div>
      </div>

      <div className="section-head">
        <div className="section-label">性能</div>
        <span className="badge-iter">待后续迭代</span>
      </div>
      <div className="setting-card locked">
        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">硬件加速编码</div>
            <div className="s-desc">使用显卡加速，转换速度更快 · 后续版本开放</div>
          </div>
          <Icon name="i-lock" style={{ width: 15, height: 15, color: 'var(--text-tertiary)' }} />
        </div>
        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">同时转换任务数</div>
            <div className="s-desc">固定为 1：其余任务在队列里排队，可调并发将在后续版本开放</div>
          </div>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            1
          </span>
        </div>
      </div>

      <div className="section-label">关于转换引擎</div>
      <div className="setting-card">
        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">版本</div>
          </div>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {engineVersion}
            {caps?.ffmpeg.ok ? '（内置）' : '（未找到）'}
          </span>
        </div>
        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">许可</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              GPL v3
            </span>
            <button
              type="button"
              className="btn-text"
              onClick={() => void window.api.openExternal('https://ffmpeg.org')}
            >
              查看源码
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
