/**
 * 托盘图标（TODO-14）：一个圆角方块加一个播放三角，**运行时画出来**，
 * 不依赖任何图片资源。
 *
 * 为什么不引一张 PNG：仓库里目前没有任何图标资源（连窗口图标都没设），
 * 引入一张就要连带改 electron-builder 的 extraResources，并区分
 * 「开发态相对路径 / 打包态 process.resourcesPath」两种取法。
 * 这条路一旦写错，症状是**打包之后托盘出现空白方块** —— 装机才会暴露。
 * 而这张图本身就是几何图形，几行判定够了。
 *
 * 抗锯齿用 4×4 超采样：托盘图标实际显示尺寸只有 16px 左右，
 * 硬边在这个尺寸下会有肉眼可见的锯齿。
 */
import { nativeImage, type NativeImage } from 'electron';

/** 逻辑尺寸 32：Windows 通知区多为 16/20px，从这里缩放下去比放大上来干净 */
export const TRAY_ICON_SIZE = 32;

/** 每像素的采样次数（4×4 = 16 次） */
const SUB = 4;

/** 底板取 --primary-500，与界面主色同源（styles/main.css） */
const PLATE: readonly [number, number, number] = [0x3d, 0x6f, 0xf0];
const GLYPH: readonly [number, number, number] = [0xff, 0xff, 0xff];

/**
 * 圆角方块的内部判定（坐标以中心为原点，四个象限对称）。
 *
 * 先看是否落在包围盒外，再把四个角单独按圆角处理：
 * 圆角之外的区域用「到角心的距离 ≤ r」判定，其余区域直接算在内。
 */
function insidePlate(x: number, y: number, size: number): boolean {
  const half = size * 0.42;
  const r = size * 0.18;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax > half || ay > half) return false;
  const dx = ax - (half - r);
  const dy = ay - (half - r);
  if (dx <= 0 || dy <= 0) return true;
  return dx * dx + dy * dy <= r * r;
}

/**
 * 播放三角的三个顶点（相对 size 的比例）。
 *
 * 顶点按**重心居中**而不是外接框居中：三角形按外接框居中看上去会明显偏左。
 * 这里三个顶点的 x 之和为 0，重心正好落在原点。
 */
const TRIANGLE: readonly (readonly [number, number])[] = [
  [-0.105, -0.2],
  [-0.105, 0.2],
  [0.21, 0],
];

/** 点在三角形内 ⟺ 对三条边的叉积同号 */
function insideTriangle(x: number, y: number, size: number): boolean {
  const p = TRIANGLE.map(([px, py]) => [px * size, py * size] as const);
  const [a, b, c] = p;
  const cross = (
    p1: readonly [number, number],
    p2: readonly [number, number],
  ): number => (p2[0] - p1[0]) * (y - p1[1]) - (p2[1] - p1[1]) * (x - p1[0]);
  const d1 = cross(a, b);
  const d2 = cross(b, c);
  const d3 = cross(c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * 画出 RGBA 原始位图（**不预乘 alpha**）。
 *
 * 白三角是叠在底板之上、且完全落在底板范围内的，所以每个采样点
 * 「在三角里」和「只属于底板」互斥，混色就成了简单的加权平均。
 */
export function renderTrayPixels(size: number = TRAY_ICON_SIZE): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const inv = 1 / (SUB * SUB);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let plate = 0;
      let glyph = 0;

      for (let sy = 0; sy < SUB; sy += 1) {
        for (let sx = 0; sx < SUB; sx += 1) {
          const px = x + (sx + 0.5) / SUB - size / 2;
          const py = y + (sy + 0.5) / SUB - size / 2;
          // 先判前景：白三角是**叠在底板之上**的，反过来的话它会被底板整个吃掉
          if (insideTriangle(px, py, size)) glyph += 1;
          else if (insidePlate(px, py, size)) plate += 1;
        }
      }

      const covered = plate + glyph;
      const i = (y * size + x) * 4;
      if (covered === 0) continue;

      const mix = (chan: 0 | 1 | 2): number =>
        (PLATE[chan] * plate + GLYPH[chan] * glyph) / covered;

      buf[i] = Math.round(mix(0));
      buf[i + 1] = Math.round(mix(1));
      buf[i + 2] = Math.round(mix(2));
      buf[i + 3] = Math.round(covered * inv * 255);
    }
  }

  return buf;
}

export function createTrayImage(size: number = TRAY_ICON_SIZE): NativeImage {
  return nativeImage.createFromBuffer(renderTrayPixels(size), {
    width: size,
    height: size,
    scaleFactor: 1,
  });
}
