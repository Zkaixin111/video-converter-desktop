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
    /**
     * 高亮显示的条件：队列页，或转换页还没开始转换（空态 / 已选好格式）。
     * 转换中不亮，因为那时拖进来的文件无处可去。
     */
    const isHot = () => {
      const s = state();
      if (s.page === 'queue') return true;
      return s.page === 'convert' && (s.stage === 'empty' || s.stage === 'setup');
    };

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
      if (app.page !== 'convert' && app.page !== 'queue') return;

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      // Electron 32+ 拿不到 File.path，必须走 preload 暴露的 webUtils 封装
      const paths = files.map((f) => window.api.getPathForFile(f)).filter(Boolean);
      if (paths.length === 0) {
        app.toast('无法读取这些文件的路径，请改用「选择文件…」', 'warning');
        return;
      }

      // 转换页 = 组装区（攒成一批再一起转）；队列页 = 执行区（直接入队）
      if (app.page === 'queue') void app.enqueuePaths(paths);
      else void app.addToBatch(paths);
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
