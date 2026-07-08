/**
 * ffprobe 输出归一化测试。
 *
 * 这个函数是「原始 JSON」和「业务判定」之间唯一的转换层，
 * 方案 §3.3 列出的 5 个坑全部在这里处理。喂的是真实 ffprobe 片段。
 */
import { describe, expect, it } from 'vitest';
import { normalizeProbe, parseBitDepth, parseFraction } from '../../src/main/core/ffmpeg/probe';

const ctx = { path: 'C:\\v\\a.mp4', sizeBytes: 100 * 1024 * 1024 };

describe('parseFraction', () => {
  it('分数帧率解析成两位小数', () => {
    expect(parseFraction('30000/1001')).toBe(29.97);
    expect(parseFraction('24000/1001')).toBe(23.98);
    expect(parseFraction('25/1')).toBe(25);
  });

  it('非法值返回 0 而不是 NaN/Infinity', () => {
    expect(parseFraction(undefined)).toBe(0);
    expect(parseFraction('0/0')).toBe(0);
    expect(parseFraction('abc')).toBe(0);
    expect(parseFraction('30')).toBe(30);
  });
});

describe('parseBitDepth', () => {
  it('从 pix_fmt 解析位深', () => {
    expect(parseBitDepth('yuv420p')).toBe(8);
    expect(parseBitDepth('yuv420p10le')).toBe(10);
    expect(parseBitDepth('yuv422p12le')).toBe(12);
    expect(parseBitDepth('gray10le')).toBe(10);
  });

  it('未知格式按 8bit 处理', () => {
    expect(parseBitDepth(undefined)).toBe(8);
    expect(parseBitDepth('rgb24')).toBe(8);
  });
});

describe('normalizeProbe · 视频流', () => {
  it('基础字段透传', () => {
    const meta = normalizeProbe(
      {
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '60.5', bit_rate: '4000000' },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            codec_long_name: 'H.264 / AVC',
            width: 1920,
            height: 1080,
            r_frame_rate: '30000/1001',
            avg_frame_rate: '30000/1001',
            pix_fmt: 'yuv420p',
          },
        ],
      },
      ctx,
    );
    expect(meta.video?.codec).toBe('h264');
    expect(meta.video?.width).toBe(1920);
    expect(meta.video?.fps).toBe(29.97);
    expect(meta.durationSec).toBe(60.5);
    // format_name 是逗号多值，必须整体保留
    expect(meta.formatName.split(',').length).toBeGreaterThan(1);
  });

  it('VFR 判定：r_frame_rate 与 avg_frame_rate 差异 >1% 才算', () => {
    const vfr = normalizeProbe(
      {
        format: { duration: '10' },
        streams: [
          { codec_type: 'video', codec_name: 'h264', r_frame_rate: '30/1', avg_frame_rate: '24/1', pix_fmt: 'yuv420p' },
        ],
      },
      ctx,
    );
    expect(vfr.video?.isVfr).toBe(true);
    expect(vfr.warnings.map((w) => w.code)).toContain('VFR');

    const cfr = normalizeProbe(
      {
        format: { duration: '10' },
        streams: [
          { codec_type: 'video', codec_name: 'h264', r_frame_rate: '30000/1001', avg_frame_rate: '30000/1001', pix_fmt: 'yuv420p' },
        ],
      },
      ctx,
    );
    expect(cfr.video?.isVfr).toBe(false);
  });

  it('码率三级兜底：流级优先', () => {
    const meta = normalizeProbe(
      {
        format: { duration: '10', bit_rate: '9999999' },
        streams: [{ codec_type: 'video', codec_name: 'h264', bit_rate: '2500000', pix_fmt: 'yuv420p' }],
      },
      ctx,
    );
    expect(meta.video?.bitrateKbps).toBe(2500);
  });

  it('码率兜底：流级缺失时用容器码率减音频', () => {
    const meta = normalizeProbe(
      {
        format: { duration: '10', bit_rate: '3000000' },
        streams: [
          { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
          { codec_type: 'audio', codec_name: 'aac', bit_rate: '192000' },
        ],
      },
      ctx,
    );
    expect(meta.video?.bitrateKbps).toBe(2808);
  });

  it('码率兜底：都没有时按体积/时长估算，且不为 0', () => {
    const meta = normalizeProbe(
      {
        format: { duration: '60' },
        streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' }],
      },
      ctx,
    );
    // 100MB / 60s ≈ 13653kbps，乘 0.95 后的量级
    expect(meta.video?.bitrateKbps).toBeGreaterThan(10000);
  });

  it('封面图（attached_pic）不得被当成视频流', () => {
    const meta = normalizeProbe(
      {
        format: { duration: '10' },
        streams: [
          { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
          { codec_type: 'audio', codec_name: 'mp3' },
        ],
      },
      ctx,
    );
    expect(meta.video).toBeNull();
    // 有 1 条音轨，所以不应出现 NO_AUDIO 警告（封面图那一路不算音轨）
    expect(meta.audioTracks).toBe(1);
  });
});

describe('normalizeProbe · 音频与轨道计数', () => {
  it('第一条音轨的字段完整提取', () => {
    const meta = normalizeProbe(
      {
        format: { duration: '10' },
        streams: [
          { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
          { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, bit_rate: '192000' },
        ],
      },
      ctx,
    );
    expect(meta.audio).toEqual({ codec: 'aac', sampleRate: 48000, channels: 2, bitrateKbps: 192 });
    expect(meta.audioTracks).toBe(1);
  });

  it('多音轨：只取第一条，但要把条数记下来给 UI 提示', () => {
    const meta = normalizeProbe(
      {
        format: { duration: '10' },
        streams: [
          { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
          { codec_type: 'audio', codec_name: 'aac' },
          { codec_type: 'audio', codec_name: 'ac3' },
          { codec_type: 'audio', codec_name: 'aac' },
        ],
      },
      ctx,
    );
    expect(meta.audioTracks).toBe(3);
    expect(meta.audio?.codec).toBe('aac');
    expect(meta.warnings.map((w) => w.code)).toContain('MULTI_AUDIO');
  });

  it('字幕轨计入 subtitleTracks', () => {
    const meta = normalizeProbe(
      {
        format: { duration: '10' },
        streams: [
          { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
          { codec_type: 'subtitle', codec_name: 'subrip' },
          { codec_type: 'subtitle', codec_name: 'ass' },
        ],
      },
      ctx,
    );
    expect(meta.subtitleTracks).toBe(2);
    expect(meta.warnings.map((w) => w.code)).toContain('SUBTITLE_PRESENT');
  });

  it('纯音频文件返回 video: null（而不是抛错）', () => {
    const meta = normalizeProbe(
      {
        format: { format_name: 'mov,mp4,m4a', duration: '10' },
        streams: [{ codec_type: 'audio', codec_name: 'aac', sample_rate: '44100', channels: 2 }],
      },
      ctx,
    );
    expect(meta.video).toBeNull();
    expect(meta.audio?.codec).toBe('aac');
  });

  it('duration 缺失时退到流级 duration，再退到 0', () => {
    const fromStream = normalizeProbe(
      { streams: [{ codec_type: 'video', codec_name: 'h264', duration: '12.5', pix_fmt: 'yuv420p' }] },
      ctx,
    );
    expect(fromStream.durationSec).toBe(12.5);

    const none = normalizeProbe({ streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' }] }, ctx);
    expect(none.durationSec).toBe(0);
  });
});
