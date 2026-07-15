/**
 * 容器矩阵的自检。
 *
 * 这一份数据是整个应用的地基：planner 依据它判定，UI 依据它渲染。
 * 复制粘贴时最容易出的错是「defaultVideo 不在 videoCodecs 里」——
 * 编译期发现不了，运行时表现是「转完打不开」。所以拿测试钉死。
 */
import { describe, expect, it } from 'vitest';
import {
  CONTAINERS,
  CONTAINER_ORDER,
  CRF_ENCODERS,
  audioBitrateFor,
  buildVideoQualityArgs,
  encoderCodec,
  isContainerKey,
} from '../../src/shared/containers';

describe('CONTAINERS · 数据自洽', () => {
  it('CONTAINER_ORDER 覆盖全部容器且无重复（顺序即 UI 显示顺序）', () => {
    expect(new Set(CONTAINER_ORDER).size).toBe(CONTAINER_ORDER.length);
    expect([...CONTAINER_ORDER].sort()).toEqual(Object.keys(CONTAINERS).sort());
  });

  it('UI 顺序与原型一致（MP4 打头，MPEG 收尾）', () => {
    expect(CONTAINER_ORDER).toEqual(['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'webm', 'mpeg']);
  });

  for (const key of CONTAINER_ORDER) {
    // 注意：defaultVideo 是**编码器名**（libx264），videoCodecs 是**编码名**（h264），
    // 两套命名空间要靠 encoderCodec 对齐后再比较
    it(`${key}: 默认视频编码器产出的编码必须在白名单内`, () => {
      expect(CONTAINERS[key].videoCodecs).toContain(encoderCodec(CONTAINERS[key].defaultVideo));
    });

    it(`${key}: 默认音频编码器产出的编码必须在白名单内`, () => {
      expect(CONTAINERS[key].audioCodecs).toContain(encoderCodec(CONTAINERS[key].defaultAudio));
    });

    it(`${key}: 扩展名以点开头且非空`, () => {
      expect(CONTAINERS[key].ext.startsWith('.')).toBe(true);
      expect(CONTAINERS[key].ext.length).toBeGreaterThan(1);
    });
  }

  it('只有 MP4 / MOV 支持 faststart', () => {
    const faststart = CONTAINER_ORDER.filter((k) => CONTAINERS[k].faststart);
    expect(faststart).toEqual(['mp4', 'mov']);
  });

  it('isContainerKey 只认矩阵里的键', () => {
    expect(isContainerKey('mp4')).toBe(true);
    expect(isContainerKey('3gp')).toBe(false);
    expect(isContainerKey('')).toBe(false);
    expect(isContainerKey(null)).toBe(false);
    expect(isContainerKey(123)).toBe(false);
    // 防止原型链污染导致 'toString' 被误判为合法容器
    expect(isContainerKey('toString')).toBe(false);
  });
});

describe('buildVideoQualityArgs', () => {
  it('libx264 用 CRF 20，不带 -b:v', () => {
    expect(buildVideoQualityArgs('libx264', 5000)).toEqual(['-crf', '20']);
  });

  it('libx265 用 CRF 24', () => {
    expect(buildVideoQualityArgs('libx265', 5000)).toEqual(['-crf', '24']);
  });

  it('libvpx-vp9 必须带 -b:v 0（否则 CRF 会被当成上限）', () => {
    expect(buildVideoQualityArgs('libvpx-vp9', 5000)).toEqual(['-crf', '24', '-b:v', '0']);
  });

  it('libsvtav1 走 CRF', () => {
    expect(buildVideoQualityArgs('libsvtav1', 5000)).toEqual(['-crf', '24']);
  });

  it('码率模式按源码率 85% 计算，上下限 800k~8000k', () => {
    expect(buildVideoQualityArgs('mpeg4', 2000)).toEqual(['-b:v', '1700k']);
    expect(buildVideoQualityArgs('mpeg4', 100)).toEqual(['-b:v', '800k']);
    expect(buildVideoQualityArgs('mpeg4', 100000)).toEqual(['-b:v', '8000k']);
  });

  it('源码率缺失时按 2500k 估算，不产出 NaN', () => {
    expect(buildVideoQualityArgs('mpeg4', null)).toEqual(['-b:v', '2125k']);
    expect(buildVideoQualityArgs('mpeg4', null).join('')).not.toContain('NaN');
  });

  it('CRF 编码器集合与实际行为一致', () => {
    for (const enc of CRF_ENCODERS) {
      expect(buildVideoQualityArgs(enc, 3000)).toContain('-crf');
    }
    expect(buildVideoQualityArgs('wmv2', 3000)).not.toContain('-crf');
  });
});

describe('audioBitrateFor', () => {
  it('opus 给 128k，其余给 192k', () => {
    expect(audioBitrateFor('libopus')).toBe('128k');
    expect(audioBitrateFor('aac')).toBe('192k');
    expect(audioBitrateFor('libmp3lame')).toBe('192k');
    expect(audioBitrateFor('wmav2')).toBe('192k');
  });

  it('未知编码器也有兜底值（不能返回 undefined，否则会拼出 "-b:a undefined"）', () => {
    expect(audioBitrateFor('something-new')).toBe('192k');
  });
});

/**
 * P1-03：档位真正生效。
 *
 * 这里同时钉住两条契约：
 *   1. 缺省（standard）必须与 MVP 完全一致 —— 老用户升级后参数不能变
 *   2. 三档之间必须真的不同 —— 否则「设置没生效」会以另一种形式复现
 */
describe('画质档位（P1-03）', () => {
  it('缺省档位等价于 standard（与 MVP 逐字节一致）', () => {
    expect(buildVideoQualityArgs('libx264', 5000)).toEqual(
      buildVideoQualityArgs('libx264', 5000, 'standard'),
    );
    expect(audioBitrateFor('aac')).toBe(audioBitrateFor('aac', 'standard'));
  });

  it('x264：high 用 18，small 用 26', () => {
    expect(buildVideoQualityArgs('libx264', 5000, 'high')).toEqual(['-crf', '18']);
    expect(buildVideoQualityArgs('libx264', 5000, 'small')).toEqual(['-crf', '26']);
  });

  it('其它 CRF 编码器：high 22 / small 30，VP9 仍要带 -b:v 0', () => {
    expect(buildVideoQualityArgs('libx265', 5000, 'high')).toEqual(['-crf', '22']);
    expect(buildVideoQualityArgs('libvpx-vp9', 5000, 'small')).toEqual([
      '-crf',
      '30',
      '-b:v',
      '0',
    ]);
  });

  it('码率模式按档位缩放：high 1.15×，small 0.45×，仍钳在 800k~8000k', () => {
    expect(buildVideoQualityArgs('mpeg4', 2000, 'high')).toEqual(['-b:v', '2300k']);
    expect(buildVideoQualityArgs('mpeg4', 2000, 'small')).toEqual(['-b:v', '900k']);
    // 上限/下限与档位无关
    expect(buildVideoQualityArgs('mpeg4', 100000, 'high')).toEqual(['-b:v', '8000k']);
    expect(buildVideoQualityArgs('mpeg4', 100, 'small')).toEqual(['-b:v', '800k']);
  });

  it('任何档位下 SR 编码器都不会出现 -crf', () => {
    for (const tier of ['high', 'standard', 'small'] as const) {
      expect(buildVideoQualityArgs('wmv2', 3000, tier)).not.toContain('-crf');
    }
  });

  it('音频码率三档递减，opus 比同档 AAC 更低', () => {
    expect(audioBitrateFor('aac', 'high')).toBe('256k');
    expect(audioBitrateFor('aac', 'small')).toBe('96k');
    expect(audioBitrateFor('libopus', 'high')).toBe('160k');
    expect(audioBitrateFor('libopus', 'small')).toBe('64k');
  });

  it('未知编码器在各档位都有兜底值', () => {
    for (const tier of ['high', 'standard', 'small'] as const) {
      expect(audioBitrateFor('something-new', tier)).toMatch(/^\d+k$/);
    }
  });
});
