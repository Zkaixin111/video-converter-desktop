/**
 * 托盘图标位图（main/trayIcon.ts）的单元测试。
 *
 * 图标是**运行时画出来**的（TODO-14），最容易犯的错是「画错了还没人发现」：
 * 等到打包装机之后才发现托盘是块空白，一切都晚了。这里把几何结果逐条钉住，
 * 其中最有价值的一条是「白三角真的在图里」——实现时真实翻过车：
 * 三角完全叠在底板范围内，判定顺序写反会让它被底板整个吃掉。
 */
import { describe, expect, it } from 'vitest';
import { renderTrayPixels, TRAY_ICON_SIZE } from '../../src/main/trayIcon';

const SIZE = TRAY_ICON_SIZE;

interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

const at = (buf: Buffer, x: number, y: number, size = SIZE): Pixel => {
  const i = (y * size + x) * 4;
  return { r: buf[i], g: buf[i + 1], b: buf[i + 2], a: buf[i + 3] };
};

describe('托盘图标位图 · TODO-14', () => {
  it('缓冲区大小必须是 size² × 4 字节', () => {
    expect(renderTrayPixels().length).toBe(SIZE * SIZE * 4);
  });

  it('四个角保持全透明：托盘图标不该是一整块方砖', () => {
    const px = renderTrayPixels();
    for (const [x, y] of [
      [0, 0],
      [SIZE - 1, 0],
      [0, SIZE - 1],
      [SIZE - 1, SIZE - 1],
    ] as const) {
      expect(at(px, x, y).a).toBe(0);
    }
  });

  it('正中心是白色的播放三角', () => {
    const c = at(renderTrayPixels(), SIZE / 2, SIZE / 2);
    expect(c.a).toBe(255);
    expect(c.r).toBeGreaterThan(240);
    expect(c.g).toBeGreaterThan(240);
    expect(c.b).toBeGreaterThan(240);
  });

  it('三角之外的底板是界面主色 #3d6ff0', () => {
    // (6,16) 在底板内、三角外：三角的左边缘离中心还有一段距离
    const p = at(renderTrayPixels(), 6, SIZE / 2);
    expect(p).toEqual({ r: 0x3d, g: 0x6f, b: 0xf0, a: 255 });
  });

  it('边缘存在半透明过渡：抗锯齿不能是硬边', () => {
    const px = renderTrayPixels();
    let partial = 0;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] > 0 && px[i] < 255) partial += 1;
    }
    expect(partial).toBeGreaterThan(0);
  });

  it('纯函数：两次渲染逐字节一致', () => {
    expect(Buffer.compare(renderTrayPixels(), renderTrayPixels())).toBe(0);
  });

  it('缩到 16px 依旧成立（不会因为尺寸变化画崩）', () => {
    const px = renderTrayPixels(16);
    expect(px.length).toBe(16 * 16 * 4);
    const c = at(px, 8, 8, 16);
    expect(c.a).toBe(255);
    expect(c.r).toBeGreaterThan(240);
    expect(at(px, 0, 0, 16).a).toBe(0);
  });
});
