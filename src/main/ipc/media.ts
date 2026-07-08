/** media:* —— 文件元数据与缩略图 */
import { ipcMain } from 'electron';
import { CH } from '../../shared/channels';
import type { MediaMeta } from '../../shared/types';
import { extractThumbnail, probeMedia } from '../core/ffmpeg/probe';
import { requireAbsPath, requireObject, wrap } from './wrap';

export function registerMediaIpc(): void {
  ipcMain.handle(CH.probe, (_e, payload: unknown) =>
    wrap<MediaMeta>(async () => {
      const { path } = requireObject(payload, 'payload');
      return probeMedia(requireAbsPath(path, 'path'));
    }),
  );

  ipcMain.handle(CH.thumbnail, (_e, payload: unknown) =>
    wrap<{ dataUrl: string | null }>(async () => {
      const { path, atSec } = requireObject(payload, 'payload');
      const file = requireAbsPath(path, 'path');
      const at = typeof atSec === 'number' && atSec >= 0 ? atSec : 2;
      return { dataUrl: await extractThumbnail(file, at) };
    }),
  );
}
