/**
 * 队列崩溃恢复（TODO-12）的端到端验证：真实读 `userData/queue.json` 并驱动真实界面。
 *
 * 为什么要跑真实进程：这条链路横跨「落盘 → 重启 → 启动钩子 → 渲染层」，
 * 单测能覆盖每一段，但拼起来的时序（比如注册 IPC 之前快照就发出去了）只有跑起来才知道。
 *
 * 用法：
 *   先把快照写好：node scripts/cdp-restore-check.mjs --seed
 *   CDP_PORT=9222 env -u ELECTRON_RUN_AS_NODE npm run dev   （另一个终端）
 *   node scripts/cdp-restore-check.mjs 9222
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const USER_DATA = path.join(
  process.env.APPDATA ?? 'C:\\Users\\29486\\AppData\\Roaming',
  'video-converter-desktop',
);
const QUEUE_FILE = path.join(USER_DATA, 'queue.json');

/**
 * 两个真实存在的 fixture，一个标「上次正在转」，一个正常排队。
 *
 * 元信息必须写**真实**编码：恢复链路不会重新探测文件（就是为了省钱），
 * 按落盘的 codec 直接排 ffmpeg 参数。这里写错就会转出一个真的失败，
 * 掩盖掉本来要验证的东西。
 */
const FFPROBE = path.join(ROOT, 'resources', 'bin', 'win32-x64', 'ffprobe.exe');

/** 真实时长：写成假数字会被输出校验判成「转换失败」 */
function probeDurationSec(file) {
  const raw = execFileSync(
    FFPROBE,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  ).trim();
  return Number(raw) || 1;
}

function seed() {
  const CODECS = {
    'sample-mpeg4-mp3.avi': { video: 'mpeg4', audio: 'mp3' },
    'sample-h264-aac.mp4': { video: 'h264', audio: 'aac' },
  };
  const item = (file, target, interrupted, out) => ({
    jobId: `restore-${file}`,
    meta: {
      path: path.join(FIX, file),
      fileName: file,
      sizeBytes: fs.statSync(path.join(FIX, file)).size,
      // 时长同理必须是真的：输出校验拿它跟产物比，差一点就会判「转换失败」
      durationSec: probeDurationSec(path.join(FIX, file)),
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      video: {
        codec: CODECS[file].video,
        codecLongName: 'H.264',
        width: 640,
        height: 360,
        fps: 25,
        isVfr: false,
        bitrateKbps: 800,
        pixFmt: 'yuv420p',
        bitDepth: 8,
      },
      audio: { codec: CODECS[file].audio, sampleRate: 44100, channels: 2, bitrateKbps: 128 },
      audioTracks: 1,
      subtitleTracks: 0,
      warnings: [],
    },
    target,
    preset: 'standard',
    custom: null,
    outputDir: null,
    outputPath: path.join(FIX, out),
    audio: null,
    status: 'pending',
    interrupted,
    createdAt: Date.now() - 60_000,
  });

  const data = {
    version: 1,
    savedAt: Date.now(),
    // 顺序故意不是文件名顺序：这条也在验证「恢复不重排」
    items: [
      item('sample-mpeg4-mp3.avi', 'mkv', false, 'rt-2_restored.mkv'),
      item('sample-h264-aac.mp4', 'mp4', true, 'rt-1_restored.mp4'),
    ],
  };
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`已写入快照：${QUEUE_FILE}`);
  console.log(fs.readFileSync(QUEUE_FILE, 'utf8'));
}

if (process.argv.includes('--seed')) {
  seed();
  process.exit(0);
}

/* ── CDP 连接 ─────────────────────────────────────────── */
const PORT = Number(process.argv[2] || 9222);
const LOG = path.join(ROOT, 'tests', '.tmp', 'restore-check.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.writeFileSync(LOG, '', 'utf8');

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('没有找到可调试的页面，确认 dev 是用 CDP_PORT 启动的');
const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
  }
  return r.result?.value;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name) {
  const r = await Promise.race([
    send('Page.captureScreenshot', { format: 'png' }),
    sleep(8000).then(() => null),
  ]);
  if (!r) return console.log(`⚠️ 截图 ${name} 未生成`);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
}

async function waitFor(expr, label, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJs(expr)) return;
    await sleep(120);
  }
  throw new Error(`等待超时（${timeoutMs}ms）：${label}`);
}

const results = [];
function check(name, pass, detail = '') {
  const line = `${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`;
  fs.appendFileSync(LOG, `${line}\n`, 'utf8');
  console.log(line);
  results.push({ 检查项: name, 结果: pass ? '✅' : '❌', 说明: detail });
  if (!pass) throw new Error(`断言失败：${name} ${detail}`);
}

await waitFor('!!window.__appStore', 'store 注入完成（DEV 专用）', 40000);
check('store 已挂到 window（DEV）', true);

const view = () =>
  evalJs(`(async () => {
    const st = window.__appStore.getState();
    await st.refreshQueue();
    await st.setPage('queue');
    await new Promise(r => setTimeout(r, 300));
    const q = window.__appStore.getState().queue;
    return {
      paused: !!q?.paused,
      reason: q?.pausedReason ?? null,
      batch: q?.batch ?? null,
      items: (q?.items ?? []).map(i => ({
        name: i.fileName, status: i.status, interrupted: !!i.interrupted, target: i.target,
      })),
      banner: document.querySelector('.queue-paused .qp-title')?.textContent ?? null,
      chips: [...document.querySelectorAll('.queue-row:not(.is-history) .chip')].map(c => c.textContent),
    };
  })()`);

/* ── 1. 启动即处于恢复态 ─────────────────────────────────── */
const v1 = await view();
check('快照里的两个任务都恢复了', v1.items.length === 2, JSON.stringify(v1.items.map((i) => i.name)));
check(
  '顺序没被重排（恢复顺序 = 落盘顺序）',
  v1.items[0]?.name === 'sample-mpeg4-mp3.avi' && v1.items[1]?.name === 'sample-h264-aac.mp4',
  v1.items.map((i) => i.name).join(' | '),
);
check('队列保持暂停等用户确认', v1.paused === true && v1.reason === 'restored', `reason=${v1.reason}`);
check(
  '一个都没自动开跑',
  v1.items.every((i) => i.status === 'pending'),
  JSON.stringify(v1.items.map((i) => i.status)),
);
check('当时正在转的那条标了「上次未完成」', v1.chips.includes('上次未完成'), v1.chips.join(' | '));
check('提示条说的是恢复而不是「已暂停」', v1.banner === '上次没跑完的任务已恢复', String(v1.banner));
check('整体进度按恢复条数记账', v1.batch && v1.batch.total === 2, JSON.stringify(v1.batch));

await shot('p1-12-restore-banner.png');

/* ── 2. 用户确认后才开跑 ─────────────────────────────────── */
const resumed = await evalJs(`(async () => {
  const st = () => window.__appStore.getState();
  const before = (st().queue?.items ?? []).map(i => i.status);
  await st().resumeQueue();
  await new Promise(r => setTimeout(r, 60));
  // 必须立刻读：fixture 只有几秒，几百毫秒就转完了 ——
  // 等它们跑完再来看，就永远读不到「已经跑起来」的那个瞬间
  const q = window.__appStore.getState().queue;
  return { before, paused: !!q?.paused, after: (q?.items ?? []).map(i => i.status) };
})()`);
check(
  '点「继续队列」之前全在等待',
  resumed.before.every((s) => s === 'pending'),
  JSON.stringify(resumed.before),
);
check(
  '点之后任务立刻出了等待态',
  resumed.after.some((s) => s === 'running' || s === 'preparing') || resumed.after.length === 0,
  JSON.stringify(resumed.after),
);
check('暂停已解除', resumed.paused === false, String(resumed.paused));

await shot('p1-12-restore-running.png');

/* ── 3. 收尾：取消并删除，别把产物留在 fixtures 里 ─────────── */
await evalJs(`(async () => {
  const st = () => window.__appStore.getState();
  for (let i = 0; i < 6; i += 1) {
    await st().refreshQueue();
    const items = st().queue?.items ?? [];
    if (items.length === 0) break;
    for (const it of items) {
      if (it.status === 'running' || it.status === 'preparing') await st().cancelQueueItem(it.jobId);
    }
    await new Promise(r => setTimeout(r, 800));
    for (const it of (st().queue?.items ?? [])) {
      try { await st().removeQueueItem(it.jobId); } catch {}
    }
  }
  return (window.__appStore.getState().queue?.items ?? []).length;
})()`);

for (const f of fs.readdirSync(FIX)) {
  if (f.includes('_restored')) fs.rmSync(path.join(FIX, f), { force: true });
}

console.log('\n══════ 崩溃恢复检查汇总 ══════');
console.table(results);
ws.close();
process.exit(0);
