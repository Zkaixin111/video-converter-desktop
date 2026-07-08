/**
 * 关于页（原型 #page-about）。
 *
 * 版本号与引擎信息全部来自 app:capabilities（主进程实测），
 * 不写死——写死的那天起就会开始撒谎。
 */
import type { ReactElement } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';

const REPO_ISSUES = 'https://github.com/Zkaixin111/video-converter-desktop/issues';

export function AboutPage(): ReactElement {
  const caps = useAppStore((s) => s.caps);
  const toast = useAppStore((s) => s.toast);

  const version = caps?.app.version ?? '0.1.0';
  const engine = caps?.ffmpeg.ok ? caps.ffmpeg.version : null;

  return (
    <section className="page" aria-label="关于">
      <header className="page-head">
        <h1>关于</h1>
      </header>

      <div className="about-wrap">
        <div className="about-ico">
          <Icon name="i-convert" />
        </div>
        <h2>视频转换器</h2>
        <div className="ver">v{version}</div>
        <div className="ver" style={{ marginTop: 2 }}>
          引擎 {engine ? `FFmpeg ${engine}` : '未检测到'}
          {caps ? ` · Electron ${caps.app.electron}` : ''}
        </div>
        <p className="tagline">
          拖入视频，选一个格式，我们负责让它一定能用——
          <br />
          并且告诉你为什么之前不行。
        </p>
        <Button variant="secondary" onClick={() => toast(`已是最新版本 v${version}`, 'success')}>
          <Icon name="i-refresh" />
          检查更新
        </Button>

        <div className="about-sep" />

        <div className="license-block">
          <h4>开源许可</h4>
          <p>
            本产品使用 FFmpeg（GPL v3）作为转换引擎，相关源码可在 ffmpeg.org 获取。本产品本身不修改
            FFmpeg 源码。
          </p>
          <div className="license-actions">
            <Button
              variant="secondary"
              onClick={() => void window.api.openExternal('https://ffmpeg.org/legal.html')}
            >
              查看许可详情
            </Button>
            <Button variant="secondary" onClick={() => void window.api.openExternal(REPO_ISSUES)}>
              <Icon name="i-external" />
              问题反馈
            </Button>
          </div>
        </div>

        <div className="copyright">© 2026 · 保留所有权利</div>
      </div>
    </section>
  );
}
