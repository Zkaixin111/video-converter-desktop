/**
 * 判定条（原型 #banner）。
 *
 * 四种形态一一对应 planner 的判定结果，颜色与图标不可混用：
 *   绿 直通 copy / 琥珀 混合直通 remux / 橙 重新压缩 transcode / 红 信息不完整
 *
 * 补充：planner 还会给出 warnings（字幕会丢、多音轨只留第一条、VFR…），
 * 这些不改变判定结论，所以作为判定条下方的小字列表呈现，而不是塞进主文案。
 */
import type { ReactElement } from 'react';
import type { ConversionMode, PlanResult } from '../../../../shared/types';
import { Icon, type IconName } from '../ui/Icon';

interface PlanSummaryProps {
  plan: PlanResult | null;
  /** 源文件信息读取不完整时的兜底提示（例如没有视频流之外的异常） */
  degraded?: boolean;
}

interface BannerMeta {
  cls: string;
  icon: IconName;
  title: string;
  desc: string;
}

function bannerFor(plan: PlanResult | null, degraded: boolean): BannerMeta {
  if (degraded || !plan) {
    return {
      cls: 'is-warn',
      icon: 'i-alert',
      title: '文件信息读取不完整',
      desc: '仍可尝试转换，但可能会失败。建议先确认文件能正常播放',
    };
  }

  const sec = plan.estimate.approxSeconds;
  const byMode: Record<ConversionMode, BannerMeta> = {
    copy: {
      cls: 'is-copy',
      icon: 'i-zap',
      title: '无损直通 · 无需重新压缩',
      desc: `画面和声音都不动，只换个封装。预计 ${sec} 秒完成，画质 100% 保留`,
    },
    remux: {
      cls: 'is-remux',
      icon: 'i-zap',
      title: '混合直通 · 画面不动，音频需要转换',
      desc: `画面不重新压缩，只转换音频轨。预计 ${sec} 秒完成，画质 100% 保留`,
    },
    transcode: {
      cls: 'is-transcode',
      icon: 'i-clock',
      title: '需要重新压缩 · 耗时更长',
      desc: `当前文件与目标格式不兼容，需要完整转换。预计 ${sec} 秒左右完成`,
    },
  };
  return byMode[plan.mode];
}

export function PlanSummary({ plan, degraded = false }: PlanSummaryProps): ReactElement {
  const meta = bannerFor(plan, degraded);
  const warnings = plan?.warnings ?? [];

  return (
    <div>
      {/* key 让 React 在模式变化时重建节点，避免属性补间造成的高度抖动 */}
      <div className={`banner ${meta.cls}`} key={meta.cls}>
        <Icon name={meta.icon} className="b-ico" />
        <div className="b-body">
          <div className="b-title">{meta.title}</div>
          <div className="b-desc">{meta.desc}</div>
        </div>
      </div>

      {warnings.length > 0 ? (
        <div className="banner-warnings">
          {warnings.map((w) => (
            <span key={w.code}>· {w.message}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
