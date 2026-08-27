/**
 * 系统托盘与关窗行为（TODO-14）的端到端验证。
 *
 * 这一项没法只用界面断言：它的全部价值都在「窗口消失之后」——
 * 进程还活着、ffmpeg 还在跑、转完的文件真的落了盘、
 * 退出时子进程被收干净。所以这里的证据来自三个世界：
 *   · CDP      → 队列状态（藏在窗口后面照样能读）
 *   · tasklist → electron.exe / ffmpeg.exe 存活
 *   · PowerShell → 主窗口标题（空 = 窗口藏起来了，而不是关了）
 *
 * 验证分两段：
 *   A. closeToTray 开（默认）：关窗 → 进程在、窗口没了、ffmpeg 继续跑完整批
 *   B. closeToTray 关：关窗 → 进程退出，且 ffmpeg.exe 无残留
 *
 * 用法：
 *   CDP_PORT=9222 env -u ELECTRON_RUN_AS_NODE npm run dev   （另一个终端）
 *   node scripts/cdp-tray-check.mjs 9222
 *
 * 注意：B 段结束时应用会真正退出（这是断言的一部分），dev 进程随之结束。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const LOG = path.join(ROOT, 'tests', '.tmp', 'tray-check.log');
const PORT = Number(process.argv[2] || 9222);

fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.writeFileSync(LOG, '', 'utf8');

const results = [];
function check(name, pass, detail = '') {
  const line = `${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`;
  fs.appendFileSync(LOG, `${line}\n`, 'utf8');
  console.log(line);
  results.push({ 检查项: name, 结果: pass ? '✅' : '❌', 说明: detail });
  if (!pass) throw new Error(`断言失败：${name} ${detail}`);
}

/* ── 进程与窗口探测（不依赖 CDP，窗口藏起来也照样能查） ── */
const hasProcess = (image) => {
  try {
    const out = execFileSync(
      'tasklist',
      ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV'],
      { encoding: 'utf8' },
    );
    return out.toLowerCase().includes(`"${image.toLowerCase()}"`);
  } catch {
    return false;
  }
};

/** 空字符串 = 这个 electron 进程没有任何可见窗口 */
const mainWindowTitle = () => {
  try {
    return execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1).MainWindowTitle",
      ],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return '<探测失败>';
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── CDP ─────────────────────────────────────────────── */
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

const waitFor = async (fn, label, timeoutMs = 30000) => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(150);
  }
  throw new Error(`等待超时（${timeoutMs}ms）：${label}（最后状态 ${JSON.stringify(last)}）`);
};

const shot = async (name) => {
  const r = await Promise.race([
    send('Page.captureScreenshot', { format: 'png' }),
    sleep(8000).then(() => null),
  ]);
  if (!r) return console.log(`⚠️ 截图 ${name} 未生成`);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
};

/* ── 界面操作 ─────────────────────────────────────────── */
// 60 秒的长样本：验证的是「关窗之后还在跑」，转得太快就抓不到中间态
const FIXTURES = ['sample-long.mp4'];
const seedQueue = () =>
  evalJs(`(async () => {
    const st = () => window.__appStore.getState();
    // enqueuePaths 在 busy 时会**静默返回**，上一轮遗留的 busy 会让后面
    // 所有断言在错误的前提下空转——这里先把前提亮出来
    if (st().busy) throw new Error('store 还在 busy，上一轮操作没收敛');
    const src = ${JSON.stringify(FIXTURES.map((f) => `${ROOT.replace(/\\/g, '/')}/tests/fixtures/${f}`))};
    await st().enqueuePaths(src);
    await st().refreshQueue();
    return (st().queue?.items ?? []).length;
  })()`);

const resetUi = () =>
  evalJs(`(async () => {
    const st = () => window.__appStore.getState();
    // 目标改成 WebM 是刻意的：sample-long 本身是 h264/mp4，MP4 目标会走直通
    // （copy），ffmpeg 不到一秒就结束——根本观察不到「关窗之后还在跑」。
    // 注意入队取的是转换页的 target，不是设置里的 defaultOutputFormat，
    // 所以这里必须 setTarget 而不是 updateSettings
    await st().setTarget('webm');
    await st().updateSettings({ openFolderAfterDone: false, failurePolicy: 'continue' });
    for (let i = 0; i < 6; i += 1) {
      await st().refreshQueue();
      const items = st().queue?.items ?? [];
      if (items.length === 0) break;
      for (const it of items) {
        if (it.status === 'running' || it.status === 'preparing') await st().cancelQueueItem(it.jobId);
      }
      await new Promise(r => setTimeout(r, 700));
      for (const it of (st().queue?.items ?? [])) {
        try { await st().removeQueueItem(it.jobId); } catch {}
      }
    }
    await st().resumeQueue();
    await st().refreshQueue();
    return (window.__appStore.getState().queue?.items ?? []).length;
  })()`);

const queueState = () =>
  evalJs(`(async () => {
    const st = window.__appStore.getState();
    await st.refreshQueue();
    const items = window.__appStore.getState().queue?.items ?? [];
    return {
      statuses: items.map(i => i.status),
      settled: items.filter(i => ['done','error','cancelled'].includes(i.status)).length,
      errors: items.filter(i => i.status === 'error').length,
    };
  })()`);

const clickClose = () => evalJs(`(async () => {
  const btn = document.querySelector('.win-ctrl button.close');
  if (!btn) return false;
  btn.click();
  return true;
})()`);

/* ══ A 段：关窗藏托盘，转码继续 ═══════════════════════ */
await waitFor(() => evalJs('!!window.__appStore'), 'store 注入完成（DEV 专用）', 40000);
await evalJs(`(async () => { await window.__appStore.getState().updateSettings({ closeToTray: true }); return true; })()`);

check('起点：主窗口可见', mainWindowTitle() !== '', `title=${mainWindowTitle()}`);
check('起点：electron 进程在跑', hasProcess('electron.exe'));

// 设置页截一张：新增的「关闭窗口时最小化到托盘」开关
await evalJs(`(async () => { await window.__appStore.getState().setPage('settings'); return true; })()`);
await sleep(300);
await shot('p1-14-close-to-tray-setting.png');

await evalJs(`(async () => { await window.__appStore.getState().setPage('queue'); return true; })()`);
check('起点：队列已清空', (await resetUi()) === 0);
await seedQueue();
// 等到真正 running 再动手：preparing 阶段跑的是 ffprobe，ffmpeg 还没起来
await waitFor(
  async () => {
    const q = await queueState();
    return q.statuses.includes('running') ? q : null;
  },
  '第一个任务进入 running',
);
await waitFor(() => hasProcess('ffmpeg.exe'), 'ffmpeg 进程出现', 10000);
check('关窗前：ffmpeg 已经在跑', true);

check('点击了标题栏 ×', (await clickClose()) === true);

// 关窗后立刻高频轮询进程表：只要在关窗**之后**还见过一次 ffmpeg，
// 就证明转码没有随窗口一起停（后面等它跑完是第二条证据）
let seenAfterClose = false;
for (let i = 0; i < 160 && !seenAfterClose; i += 1) {
  if (hasProcess('ffmpeg.exe')) seenAfterClose = true;
  else await sleep(50);
}
await sleep(800);
check('关窗后：electron 进程还活着', hasProcess('electron.exe'));
check('关窗后：窗口藏起来了而不是关掉', mainWindowTitle() === '', `title=${mainWindowTitle()}`);
check('关窗后：ffmpeg 还在后台转', seenAfterClose);

// 窗口藏了，但 CDP 还够得着：等整批跑完。
// 成功的条目会自动出队（drop），所以「队列空了」就是「跑完了」；
// 失败的条目会留在队列里标红，由 errors 分支兜住
const finished = await waitFor(async () => {
  const q = await queueState();
  if (q.errors > 0) throw new Error(`后台转码出了 ${q.errors} 个失败：${JSON.stringify(q)}`);
  return q.statuses.length === 0 ? q : null;
}, '隐藏状态下整批跑完', 420000);
check('藏起来之后整批跑完，没有一个失败', finished.errors === 0, '队列已清空');
check('跑完之后进程仍然在（托盘语义）', hasProcess('electron.exe'));

/* ══ B 段：关掉设置 → 关窗即退出，无残留 ffmpeg ═══════ */
await evalJs(`(async () => { await window.__appStore.getState().updateSettings({ closeToTray: false }); return true; })()`);
check('已把设置改回「关窗即退出」', true);
check('第二段起点：队列已清空', (await resetUi()) === 0);
await evalJs(`(async () => { await window.__appStore.getState().updateSettings({ closeToTray: false }); return true; })()`);
check('第二段入队了长样本', (await seedQueue()) === 1);
await waitFor(
  async () => {
    const q = await queueState();
    return q.statuses.includes('running') ? q : null;
  },
  '第二批任务进入 running',
);
await waitFor(() => hasProcess('ffmpeg.exe'), '第二批 ffmpeg 出现', 10000);
check('第二段：ffmpeg 在跑', true);

await clickClose();

// 进程要自己走完 before-quit：杀子进程 → 清快照 → 退出
let exited = false;
for (let i = 0; i < 80; i += 1) {
  await sleep(150);
  if (!hasProcess('electron.exe')) {
    exited = true;
    break;
  }
}
check('关窗即退出：electron 进程退出了', exited);

let ffmpegGone = false;
for (let i = 0; i < 40; i += 1) {
  if (!hasProcess('ffmpeg.exe')) {
    ffmpegGone = true;
    break;
  }
  await sleep(150);
}
check('退出后没有残留的 ffmpeg.exe', ffmpegGone);

console.log('\n══════ 托盘与关窗检查汇总 ══════');
console.table(results);
ws.close();
process.exit(0);
