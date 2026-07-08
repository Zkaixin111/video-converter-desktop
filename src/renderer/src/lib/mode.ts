/**
 * 转换模式的展示文案。
 *
 * 三种模式的中文说法分散在判定条、进度卡、完成卡三处，
 * 抽成一处避免同一件事出现三种叫法。
 */
import type { ConversionMode } from '../../../shared/types';

export const MODE_LABEL: Record<ConversionMode, string> = {
  copy: '无损直通',
  remux: '混合直通',
  transcode: '重新压缩',
};

/** 进度卡标题 */
export const MODE_RUNNING_TITLE: Record<ConversionMode, string> = {
  copy: '正在无损直通…',
  remux: '正在转换音频…',
  transcode: '正在重新压缩…',
};
