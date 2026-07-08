/**
 * 测试用的 MediaMeta 构造器。
 *
 * 集中一处的好处：以后 MediaMeta 加字段，只改这里，不会 60 个用例全红。
 */
import type { AudioStream, MediaMeta, VideoStream } from '../../src/shared/types';

export function makeVideo(over: Partial<VideoStream> = {}): VideoStream {
  return {
    codec: 'h264',
    codecLongName: 'H.264 / AVC',
    width: 1920,
    height: 1080,
    fps: 30,
    isVfr: false,
    bitrateKbps: 4000,
    pixFmt: 'yuv420p',
    bitDepth: 8,
    ...over,
  };
}

export function makeAudio(over: Partial<AudioStream> = {}): AudioStream {
  return {
    codec: 'aac',
    sampleRate: 48000,
    channels: 2,
    bitrateKbps: 192,
    ...over,
  };
}

export function makeMeta(over: Partial<MediaMeta> = {}): MediaMeta {
  return {
    path: 'C:\\videos\\sample.mp4',
    fileName: 'sample.mp4',
    sizeBytes: 100 * 1024 * 1024,
    durationSec: 60,
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    video: makeVideo(),
    audio: makeAudio(),
    audioTracks: 1,
    subtitleTracks: 0,
    warnings: [],
    ...over,
  };
}
