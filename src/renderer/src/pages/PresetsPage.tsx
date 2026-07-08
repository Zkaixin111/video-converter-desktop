/**
 * 参数预设页（原型 #page-presets）。
 *
 * 8 个容器 × 3 档质量。**这一页的选择在 MVP 不参与转换**，
 * 只用 electron-store 持久化；页面顶部加了灰色提示条如实告知，
 * 底部「精细调节」按原型锁定并标【待后续迭代】。
 */
import type { ReactElement } from 'react';
import { CONTAINERS, CONTAINER_ORDER } from '../../../shared/containers';
import type { ContainerKey, PresetTier } from '../../../shared/types';
import { MULT_TABLE, PRESET_DESC, TIERS } from '../lib/presets';
import { useAppStore } from '../store/useAppStore';
import { Icon } from '../components/ui/Icon';

export function PresetsPage(): ReactElement {
  const settings = useAppStore((s) => s.settings);
  const update = useAppStore((s) => s.updateSettings);
  const toast = useAppStore((s) => s.toast);

  const presets = settings?.presets;

  const choose = (fmt: ContainerKey, tier: PresetTier): void => {
    if (!presets || presets[fmt] === tier) return;
    void update({ presets: { ...presets, [fmt]: tier } });
    const tierName = TIERS.find((t) => t.key === tier)?.name ?? tier;
    toast(`${CONTAINERS[fmt].label} 已设为「${tierName}」`, 'success');
  };

  return (
    <section className="page" aria-label="参数预设">
      <header className="page-head">
        <h1>参数预设</h1>
        <p>为每种格式设定默认的质量与体积倾向，这些设置会自动应用到转换页。</p>
      </header>

      <div className="notice">
        <Icon name="i-info" />
        <div>该设置暂未接入转换流程，将在 P1 版本生效；当前转换使用固定的兼容性优先参数。</div>
      </div>

      <div>
        {CONTAINER_ORDER.map((fmt) => (
          <div className="preset-card card" key={fmt}>
            <div className="preset-head">
              <span className="pname">{CONTAINERS[fmt].label}</span>
              <span className="pdesc">{PRESET_DESC[fmt]}</span>
            </div>
            <div className="tier-row" role="group" aria-label={`${CONTAINERS[fmt].label} 质量档位`}>
              {TIERS.map((tier) => (
                <button
                  key={tier.key}
                  type="button"
                  className="tier"
                  aria-pressed={presets?.[fmt] === tier.key}
                  onClick={() => choose(fmt, tier.key)}
                >
                  <span className="tname">{tier.name}</span>
                  <span className="tdesc">{tier.desc}</span>
                  <span className="tmult">体积约 {MULT_TABLE[fmt][tier.key]}</span>
                  <span className="tick">
                    <Icon name="i-check" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="advanced-card locked">
        <div className="a-ico">
          <Icon name="i-lock" />
        </div>
        <div className="a-body">
          <div className="a-title">精细调节</div>
          <div className="a-desc">画质数值、编码方式、文件体积上限等手动设置，将在后续版本开放</div>
        </div>
        <span className="badge-iter">待后续迭代</span>
      </div>
    </section>
  );
}
