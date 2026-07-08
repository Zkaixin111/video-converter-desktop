/**
 * 设置页（原型 #page-settings）。
 *
 * 真生效的三项：默认保存位置、默认输出格式、完成后打开文件夹、界面密度（共四项）。
 * 主题与性能区按原型置灰并标注「后续版本」，不做假的开关。
 */
import type { ReactElement } from 'react';
import { CONTAINERS, CONTAINER_ORDER } from '../../../shared/containers';
import type { ContainerKey } from '../../../shared/types';
import { call, messageOf } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { Icon } from '../components/ui/Icon';

export function SettingsPage(): ReactElement {
  const settings = useAppStore((s) => s.settings);
  const caps = useAppStore((s) => s.caps);
  const update = useAppStore((s) => s.updateSettings);
  const toast = useAppStore((s) => s.toast);

  const engineVersion = caps?.ffmpeg.version ?? '未检测到';

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

      <div className="section-label">外观</div>
      <div className="setting-card">
        <div className="setting-row">
          <div className="s-body">
            <div className="s-name">主题</div>
            <div className="s-desc">深色模式将在后续版本提供</div>
          </div>
          <div className="segmented" role="group" aria-label="主题">
            <button type="button" aria-pressed onClick={() => toast('当前为浅色主题', 'info')}>
              浅色
            </button>
            <button type="button" disabled aria-pressed={false}>
              深色
            </button>
            <button type="button" disabled aria-pressed={false}>
              跟随系统
            </button>
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
            <div className="s-desc">当前版本仅支持单文件转换</div>
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
