/**
 * 生成集成测试用的小体积 fixture。
 *
 * 为什么要现生成而不是把视频提交进仓库：
 *   1) 一个 1 秒的 320×240 视频只有几十 KB，但二进制进了 git 就再也拿不掉；
 *   2) fixture 必须能随手重造（换机器、换编码器版本都能复现）。
 *
 * 用法：node scripts/make-fixtures.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
// 与 src/main/core/ffmpeg/paths.ts 的命名规则保持一致：Windows 才带 .exe。
// CI 在 Linux 上跑时，如果这里写死 .exe，脚本会直接退出 1。
const EXE = process.platform === 'win32' ? '.exe' : '';
const BIN = path.join(ROOT, 'resources', 'bin', `${process.platform}-${process.arch}`, `ffmpeg${EXE}`);
const OUT = path.join(ROOT, 'tests', 'fixtures');

if (!fs.existsSync(BIN)) {
  console.error(`\n✗ 找不到 ffmpeg：${BIN}\n  请先把 ffmpeg.exe / ffprobe.exe 放进 resources/bin/<平台>-<架构>/\n`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

function run(args) {
  execFileSync(BIN, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit',
    windowsHide: true,
  });
}

const SRC = [
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=320x240:rate=25:duration=2',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=2',
];

const base = path.join(OUT, 'sample-h264-aac.mp4');
console.log('· sample-h264-aac.mp4');
run([...SRC, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', base]);

console.log('· sample-h264-ac3.mkv（h264 + ac3，用于验证「画面直通 + 音频重编码」）');
run(['-i', base, '-c:v', 'copy', '-c:a', 'ac3', '-b:a', '192k', path.join(OUT, 'sample-h264-ac3.mkv')]);

console.log('· sample-mpeg4-mp3.avi（老编码，用于验证全量重编码）');
run(['-i', base, '-c:v', 'mpeg4', '-q:v', '6', '-c:a', 'libmp3lame', path.join(OUT, 'sample-mpeg4-mp3.avi')]);

console.log('· sample-noaudio.mp4（纯视频，用于验证 0:a:0? 可选映射）');
run([...SRC.slice(0, 4), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', path.join(OUT, 'sample-noaudio.mp4')]);

console.log('· sample-audio.m4a（纯音频，用于验证 video:null）');
run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', path.join(OUT, 'sample-audio.m4a')]);

console.log('· sample-long.mp4（720p × 60 秒，给托盘 / 退出这类时序验证用：转得太快就观察不到中间态）');
run([
  '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=60',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '96k', '-shortest',
  path.join(OUT, 'sample-long.mp4'),
]);

console.log('· sample-broken.mp4（截断到 40%，用于验证 moov atom 报错）');
const buf = fs.readFileSync(base);
fs.writeFileSync(path.join(OUT, 'sample-broken.mp4'), buf.subarray(0, Math.floor(buf.length * 0.4)));

console.log('· sample-fake.mp4（文本改后缀，用于验证 Invalid data）');
fs.writeFileSync(path.join(OUT, 'sample-fake.mp4'), 'this is definitely not a video file\n'.repeat(40));

console.log(`\n✓ fixture 已生成：${OUT}`);
for (const f of fs.readdirSync(OUT)) {
  console.log(`  ${f.padEnd(26)} ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1)} KB`);
}
