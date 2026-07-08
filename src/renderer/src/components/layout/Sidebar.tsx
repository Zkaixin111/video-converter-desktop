/**
 * 侧边栏导航。
 *
 * 结构与原型一致：5 个入口 + 两个分组标题 + 分隔线 + 版本号。
 * 选中态靠 `aria-current="page"`，样式表里用它控制左侧竖条与底色，
 * 不额外加 class，避免出现「class 写了但样式没跟上」的二套逻辑。
 */
import type { ReactElement } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import type { Page } from '../../store/useAppStore';

interface NavItem {
  page: Page;
  icon: IconName;
  label: string;
  /** 「迭代」徽标：功能属于后续版本 */
  iter?: boolean;
}

const MAIN: NavItem[] = [{ page: 'convert', icon: 'i-convert', label: '转换' }];

const WORKSPACE: NavItem[] = [{ page: 'queue', icon: 'i-queue', label: '任务队列', iter: true }];

const CONFIG: NavItem[] = [
  { page: 'presets', icon: 'i-preset', label: '参数预设' },
  { page: 'settings', icon: 'i-settings', label: '设置' },
];

const FOOTER: NavItem[] = [{ page: 'about', icon: 'i-info', label: '关于' }];

interface SidebarProps {
  current: Page;
  version: string;
  onNavigate: (page: Page) => void;
}

function Item({
  item,
  current,
  onNavigate,
}: {
  item: NavItem;
  current: Page;
  onNavigate: (page: Page) => void;
}): ReactElement {
  const active = item.page === current;
  return (
    <button
      type="button"
      className="nav-item"
      data-page={item.page}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNavigate(item.page)}
    >
      <i className="ind" />
      <Icon name={item.icon} className="nav-ico" />
      <span className="grow">{item.label}</span>
      {item.iter ? <em className="badge-iter">迭代</em> : null}
    </button>
  );
}

export function Sidebar({ current, version, onNavigate }: SidebarProps): ReactElement {
  return (
    <nav className="sidebar" aria-label="主导航">
      {MAIN.map((item) => (
        <Item key={item.page} item={item} current={current} onNavigate={onNavigate} />
      ))}

      <div className="nav-group">工作区</div>
      {WORKSPACE.map((item) => (
        <Item key={item.page} item={item} current={current} onNavigate={onNavigate} />
      ))}

      <div className="nav-group">配置</div>
      {CONFIG.map((item) => (
        <Item key={item.page} item={item} current={current} onNavigate={onNavigate} />
      ))}

      <div className="nav-divider" />
      {FOOTER.map((item) => (
        <Item key={item.page} item={item} current={current} onNavigate={onNavigate} />
      ))}

      <div className="nav-foot mono">v{version}</div>
    </nav>
  );
}
