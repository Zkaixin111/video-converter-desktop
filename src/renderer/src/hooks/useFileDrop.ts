/**
 * 全窗口拖拽入口。
 *
 * 两个必须做到的点：
 *   1. 无论在哪个页面，`dragover` / `drop` 都要 preventDefault。
 *      否则 Electron 会把文件当成导航目标，直接把窗口开成那个视频（页面被替换，回不去）。
 *   2. 高亮只在「转换页 + 空态」出现，其余时候静默接收，交给外层提示。
 */
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';

export function useFileDrop(): boolean {
  const [dragging, setDragging] = useState(false);
  // 用 ref 记录计数：dragenter/dragleave 会在子元素上反复触发
  const depth = useRef(0);

  useEffect(() => {
    const state = () => useAppStore.getState();
    const isHot = () => state().page === 'convert' && state().stage === 'empty';

    const onDragEnter = (e: DragEvent): void => {
      if (!isHot()) return;
      e.preventDefault();
      depth.current += 1;
      if (depth.current === 1) setDragging(true);
    };

    const onDragOver = (e: DragEvent): void => {
      // 必须无条件阻止默认行为，否则 drop 事件根本不会触发
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = isHot() ? 'copy' : 'none';
    };

    const onDragLeave = (): void => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };

    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);

      const app = state();
      if (app.page !== 'convert') return;
      if (app.stage !== 'empty') {
        app.toast('当前已有一个文件，请先点击「更换」', 'warning');
        return;
      }

      const file = e.dataTransfer?.files?.[0];
      if (!file) return;

      // Electron 32+ 拿不到 File.path，必须走 preload 暴露的 webUtils 封装
      const path = window.api.getPathForFile(file);
      if (!path) {
        app.toast('无法读取这个文件的路径，请改用「选择文件…」', 'warning');
        return;
      }
      void app.loadFromPath(path);
    };

    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragend', onDragLeave);
    document.addEventListener('drop', onDrop);

    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragend', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, []);

  return dragging;
}
