/**
 * 参数预设页（原型 #page-presets）。
 *
 * 8 个容器 × 3 档质量：档位 → CRF / 目标码率 / 音频码率 的映射在 shared/containers.ts，
 * 由 planner 消费。直通（只换封装）不经过编码器，所以档位对它是空操作。
 *
 * 每张卡片下方是**精细调节**（手动画质参数）：展开后可覆盖编码器、CRF / 目标码率、
 * 音频码率、编码速度。它是档位之上的一层，而不是替掉档位——关掉开关就完全按档位走。
 * 越界值与不被支持的编码器由主进程钳住并写进 `plan.quality.notes`，界面在这里显示出来，
 * 避免出现「保存成功但实际没生效」的误会。
 */
import { useState, type ReactElement } from 'react';
import {
  CONTAINERS,
  CONTAINER_ORDER,
  ENCODER_CHOICES,
  SPEED_PRESETS,
  encoderCodec,
} from '../../../shared/containers';
import type {
  ContainerKey,
  PresetTier,
  QualityOverrides,
  Settings,
} from '../../../shared/types';
import { MULT_TABLE, PRESET_DESC, TIERS } from '../lib/presets';
import { useAppStore } from '../store/useAppStore';
import { Icon } from '../components/ui/Icon';

/** 该容器能接受的编码器：按「产出的 codec_name 在白名单里」过滤 */
function encodersFor(fmt: ContainerKey): string[] {
  const spec = CONTAINERS[fmt];
  return ENCODER_CHOICES.filter(
    (enc) => spec.videoCodecs.includes(encoderCodec(enc)) || spec.videoCodecs.includes(enc),
  );
}

function currentOverride(settings: Settings | null, fmt: ContainerKey): QualityOverrides {
  return settings?.quality?.[fmt] ?? {};
}

export function PresetsPage(): ReactElement {
  const settings = useAppStore((s) => s.settings);
  const update = useAppStore((s) => s.updateSettings);
  const toast = useAppStore((s) => s.toast);

  const [expanded, setExpanded] = useState<ContainerKey | null>(null);
  /** 草稿：点「保存」才落到设置里，避免输入一半就触发整页重算判定 */
  const [draft, setDraft] = useState<Partial<Record<ContainerKey, QualityOverrides>>>({});

  const presets = settings?.presets;

  const choose = (fmt: ContainerKey, tier: PresetTier): void => {
    if (!presets || presets[fmt] === tier) return;
    void update({ presets: { ...presets, [fmt]: tier } });
    const tierName = TIERS.find((t) => t.key === tier)?.name ?? tier;
    toast(`${CONTAINERS[fmt].label} 已设为「${tierName}」`, 'success');
  };

  const toggle = (fmt: ContainerKey): void => {
    setExpanded((cur) => (cur === fmt ? null : fmt));
    // 展开时把已保存的值灌进草稿，否则上一次的编辑会「复活」
    setDraft((cur) => ({ ...cur, [fmt]: { ...currentOverride(settings, fmt), ...(cur[fmt] ?? {}) } }));
  };

  const patchDraft = (fmt: ContainerKey, patch: QualityOverrides): void => {
    setDraft((cur) => ({ ...cur, [fmt]: { ...(cur[fmt] ?? {}), ...patch } }));
  };

  const save = (fmt: ContainerKey): void => {
    const next = { ...(settings?.quality ?? {}), [fmt]: { ...(draft[fmt] ?? {}), enabled: true } };
    void update({ quality: next });
    toast(`${CONTAINERS[fmt].label} 的精细调节已生效`, 'success');
  };

  const disable = (fmt: ContainerKey): void => {
    const next = {
      ...(settings?.quality ?? {}),
      [fmt]: { ...currentOverride(settings, fmt), enabled: false },
    };
    void update({ quality: next });
    setDraft((cur) => ({ ...cur, [fmt]: { ...(cur[fmt] ?? {}), enabled: false } }));
    toast(`${CONTAINERS[fmt].label} 已恢复按档位取参数`, 'info');
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
          需要更精确的数值时，展开卡片底部的「精细调节」。
        </div>
      </div>

      <div>
        {CONTAINER_ORDER.map((fmt) => {
          const saved = currentOverride(settings, fmt);
          const draftItem = draft[fmt] ?? saved;
          const open = expanded === fmt;
          const encoders = encodersFor(fmt);
          const pickedEncoder = draftItem.videoEncoder ?? CONTAINERS[fmt].defaultVideo;

          return (
            <div className="preset-card card" key={fmt}>
              <div className="preset-head">
                <span className="pname">{CONTAINERS[fmt].label}</span>
                <span className="pdesc">{PRESET_DESC[fmt]}</span>
                {saved.enabled ? <span className="adv-on">精细调节已启用</span> : null}
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

              <div className="adv">
                <button
                  type="button"
                  className="adv-toggle"
                  aria-expanded={open}
                  onClick={() => toggle(fmt)}
                >
                  <Icon name={open ? 'i-chevron-down' : 'i-chevron-right'} />
                  精细调节
                </button>

                {open ? (
                  <div className="adv-body">
                    <label className="adv-field">
                      <span>视频编码器</span>
                      <select
                        value={pickedEncoder}
                        onChange={(e) => patchDraft(fmt, { videoEncoder: e.target.value })}
                      >
                        <option value={CONTAINERS[fmt].defaultVideo}>
                          默认（{CONTAINERS[fmt].defaultVideo}）
                        </option>
                        {encoders
                          .filter((enc) => enc !== CONTAINERS[fmt].defaultVideo)
                          .map((enc) => (
                            <option key={enc} value={enc}>
                              {enc}
                            </option>
                          ))}
                      </select>
                    </label>

                    <label className="adv-field">
                      <span>CRF（越小画质越好）</span>
                      <input
                        type="number"
                        min={0}
                        max={63}
                        placeholder={
                          pickedEncoder === 'libx264' ? '0–51' : '0–63'
                        }
                        value={draftItem.crf ?? ''}
                        onChange={(e) =>
                          patchDraft(fmt, {
                            crf: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                      />
                    </label>

                    <label className="adv-field">
                      <span>目标视频码率（kbps）</span>
                      <input
                        type="number"
                        min={100}
                        max={50000}
                        placeholder="不支持 CRF 的编码器用它"
                        value={draftItem.videoBitrateKbps ?? ''}
                        onChange={(e) =>
                          patchDraft(fmt, {
                            videoBitrateKbps:
                              e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                      />
                    </label>

                    <label className="adv-field">
                      <span>音频码率</span>
                      <input
                        type="text"
                        placeholder="如 192k"
                        value={draftItem.audioBitrate ?? ''}
                        onChange={(e) => patchDraft(fmt, { audioBitrate: e.target.value })}
                      />
                    </label>

                    <label className="adv-field">
                      <span>编码速度</span>
                      <select
                        value={draftItem.speed ?? 'veryfast'}
                        disabled={!['libx264', 'libx265'].includes(pickedEncoder)}
                        onChange={(e) => patchDraft(fmt, { speed: e.target.value })}
                      >
                        {SPEED_PRESETS.map((sp) => (
                          <option key={sp} value={sp}>
                            {sp}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="adv-actions">
                      <button type="button" className="btn-primary-sm" onClick={() => save(fmt)}>
                        保存并生效
                      </button>
                      {saved.enabled ? (
                        <button type="button" className="btn-text" onClick={() => disable(fmt)}>
                          恢复按档位取参数
                        </button>
                      ) : null}
                      <span className="adv-hint">
                        数值越界会自动取到合法区间，不支持的组合会回落默认值（转换页会写明改了什么）
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
