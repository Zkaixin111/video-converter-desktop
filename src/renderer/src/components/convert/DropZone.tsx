/**
 * 空态拖拽区（原型 #homeEmpty）。
 *
 * 320px 高、居中图标 + 主副文案 + 选择文件按钮，下方 3 条能力说明。
 * 「试试示例」那一行属于原型演示数据，真实应用必须读用户自己的文件，已移除（见 MVP 计划 §4 Step 6）。
 *
 * P1 之后多了一个「一次选多个」的次要入口：主按钮保持单个文件的老动线，
 * 想批量的人点这一行即可，两种习惯都不用改。
 */
import type { ReactElement } from 'react';
import { MAX_BATCH_TOTAL } from '../../../../shared/batch';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

interface DropZoneProps {
  /** 正在解析用户刚选/拖进来的文件 */
  busy: boolean;
  /** 选单个文件 */
  onPick: () => void;
  /** 一次选多个（最多 MAX_BATCH_TOTAL 个） */
  onPickMany: () => void;
}

const FEATURES = [
  { icon: 'i-zap' as const, title: '能直通就直通', desc: '不重新压缩，几秒完成' },
  { icon: 'i-shield' as const, title: '文件不出本机', desc: '全程离线处理' },
  { icon: 'i-badge-check' as const, title: '转完自动校验', desc: '告诉你结果能不能用' },
];

export function DropZone({ busy, onPick, onPickMany }: DropZoneProps): ReactElement {
  return (
    <div>
      <div className="dropzone">
        <div className="dz-icon">
          <Icon name="i-upload" />
        </div>
        <div className="dz-title">{busy ? '正在读取文件信息…' : '把视频拖到这里'}</div>
        <div className="dz-sub">
          支持 MP4、MKV、AVI、MOV、FLV 等常见格式 · 可一次加入最多 {MAX_BATCH_TOTAL} 个
        </div>
        <Button variant="secondary" onClick={onPick} disabled={busy}>
          {busy ? '读取中…' : '选择文件…'}
        </Button>
        <button type="button" className="btn-text dz-more" disabled={busy} onClick={onPickMany}>
          一次选择多个视频…
        </button>
      </div>

      <div className="feature-strip">
        {FEATURES.map((f) => (
          <div key={f.title}>
            <Icon name={f.icon} />
            <div>
              <b>{f.title}</b>
              <span>{f.desc}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
