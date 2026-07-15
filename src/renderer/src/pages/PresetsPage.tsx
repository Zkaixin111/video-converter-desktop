/**
 * 参数预设页（原型 #page-presets）。
 *
 * 8 个容器 × 3 档质量，P1 起**真实参与编码**：
 * 档位 → CRF / 目标码率 / 音频码率 的映射在 shared/containers.ts，
 * 由 planner 消费。直通（只换封装）不经过编码器，所以档位对它是空操作，
 * 页面顶部把这一点如实写出来，避免「选了体积优先但文件没变小」被当成 bug。
 * 底部「精细调节」仍按原型锁定。
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
        <div>
          档位已即时生效：需要重新压缩时决定画质与体积。无损直通（只换封装）不经过编码器，不受档位影响。
        </div>
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
