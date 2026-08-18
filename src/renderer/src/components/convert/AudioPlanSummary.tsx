/**
 * 音频提取的判定条（TODO-20）。
 *
 * 只有两种形态，与视频那套四态一一对应但**不复用**：
 *   · copy   —— 源音轨正好是目标编码，直接抽出来（音质 100% 保留）
 *   · encode —— 源音轨与目标编码不同，必须重新编码（例如 AAC → MP3）
 *
 * 文案刻意不出现编码器名（libmp3lame / aac）：
 * 与文件卡、视频判定条同一口径，界面上只讲结论与代价。
 */
import type { ReactElement } from 'react';
import { AUDIO_FORMATS } from '../../../../shared/audio';
import type { AudioPlanResult } from '../../../../shared/types';
import { formatBytes } from '../../../../shared/estimate';
import { Icon, type IconName } from '../ui/Icon';

interface AudioPlanSummaryProps {
  plan: AudioPlanResult | null;
  /** 源文件没有音轨：判定算不出来，但仍然要给出明确原因 */
  noAudio?: boolean;
}

interface BannerMeta {
  cls: string;
  icon: IconName;
  title: string;
  desc: string;
}

function bannerFor(plan: AudioPlanResult | null, noAudio: boolean): BannerMeta {
  if (noAudio || !plan) {
    return {
      cls: 'is-warn',
      icon: 'i-alert',
      title: '这个文件没有音轨',
      desc: '提取音频需要文件里带声音。换一个带声音的文件，或改回「视频转换」。',
    };
  }

  const label = AUDIO_FORMATS[plan.format].label;
  const sec = plan.estimate.approxSeconds;

  if (plan.audioAction === 'copy') {
    return {
      cls: 'is-copy',
      icon: 'i-zap',
      title: `直接抽取音轨 · 不做重新编码`,
      desc: `原文件的声音已经是 ${label} 编码，直接抽出来。预计 ${sec} 秒完成，音质 100% 保留`,
    };
  }

  return {
    cls: 'is-transcode',
    icon: 'i-clock',
    title: '需要重新编码 · 耗时略长',
    desc: `原文件的声音不是 ${label} 编码，要转成 ${label}。预计 ${sec} 秒左右完成`,
  };
}

export function AudioPlanSummary({ plan, noAudio = false }: AudioPlanSummaryProps): ReactElement {
  const meta = bannerFor(plan, noAudio);
  const warnings = plan?.warnings ?? [];

  // 码率只在「真的会重编码」时出现：直接抽取时文件里的码率本来就是原有的，
  // 显示它反而像「我们改了音质」。
  const bitrateNote =
    plan && plan.audioAction === 'encode' && plan.bitrate ? `音质档位：${plan.bitrate}` : null;

  const sizeNote = plan ? `预计约 ${formatBytes(plan.estimateBytes)}` : null;

  return (
    <div>
      <div className={`banner ${meta.cls}`} key={meta.cls}>
        <Icon name={meta.icon} className="b-ico" />
        <div className="b-body">
          <div className="b-title">{meta.title}</div>
          <div className="b-desc">{meta.desc}</div>
        </div>
      </div>

      {bitrateNote || sizeNote || warnings.length > 0 ? (
        <div className="banner-warnings">
          {bitrateNote ? <span key="bitrate">· {bitrateNote}</span> : null}
          {sizeNote ? <span key="size">· {sizeNote}</span> : null}
          {warnings.map((w) => (
            <span key={w.code}>· {w.message}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
