/**
 * 批量队列的界面验证（开发态，通过 CDP 驱动真实界面 + 真实转码）。
 *
 * 只做「看一眼确认」是不够的，这里每一步都断言：
 *   1. 共用全局参数模式：新任务不带 custom，卡片显示「跟随全局」
 *   2. 切到单任务独立参数后再入队：新任务带 custom，卡片显示「自定义」
 *      —— 而先前入队的任务仍然是「跟随全局」（切换只影响后续新增）
 *   3. 队列条目可以展开编辑器单独改格式
 *   4. 任务失败 → 标红 + 队列暂停（失败策略 pause）+ 提示条出现
 *   5. 删除失败任务后暂停自动解除
 *
 * 用法：
 *   CDP_PORT=9222 pnpm dev      （另一个终端）
 *   node scripts/cdp-queue-check.mjs 9222
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const FIX = path.join(ROOT, 'tests', 'fixtures');
/** 输出到临时目录，别把 tests/fixtures 塞满产物（默认输出位置是「源文件同级」） */
const OUT_DIR = path.join(ROOT, 'tests', '.tmp', 'cdp-output');

const PORT = Number(process.argv[2] || 9222);

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
  const r = await send('Page.captureScreenshot', { format: 'png' });
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
  results.push({ 检查项: name, 结果: pass ? '✅' : '❌', 说明: detail });
  if (!pass) throw new Error(`断言失败：${name} ${detail}`);
}

/* ── 0. 就绪 ───────────────────────────────────────────── */
await waitFor('!!window.__appStore', 'store 注入完成（DEV 专用）', 20000);
check('store 已挂到 window（DEV）', true);

/* ── 工具：清空队列 / 入队 / 读快照 ──────────────────────── */
const resetUi = () =>
  evalJs(`(async () => {
    const st = window.__appStore.getState();
    await st.refreshQueue();
    for (const it of (window.__appStore.getState().queue?.items ?? [])) {
      if (it.status === 'running' || it.status === 'preparing') {
        await window.api.cancelQueueItem(it.jobId);
      }
    }
    await new Promise(r => setTimeout(r, 700));
    await window.__appStore.getState().refreshQueue();
    for (const it of (window.__appStore.getState().queue?.items ?? [])) {
      try { await window.api.removeQueueItem(it.jobId); } catch {}
    }
    await window.__appStore.getState().refreshQueue();
    await window.__appStore.getState().updateSettings({ openFolderAfterDone: false });
    window.__appStore.getState().setPage('queue');
    await new Promise(r => setTimeout(r, 250));
    return (window.__appStore.getState().queue?.items ?? []).length;
  })()`);

/**
 * 入队并返回**本次新增**的条目。
 *
 * 必须按 jobId 取差集：队列是活的，读「整个队列」会把前面批次里
 * 还没跑完的任务也算进来（甚至因为短任务已经跑完而读到空数组）。
 */
const enqueue = (paths) =>
  evalJs(`(async () => {
    const before = new Set((window.__appStore.getState().queue?.items ?? []).map(i => i.jobId));
    await window.__appStore.getState().addPaths(${JSON.stringify(paths)}, true);
    await new Promise(r => setTimeout(r, 500));
    const q = window.__appStore.getState().queue;
    const slim = (i) => ({
      jobId: i.jobId, name: i.fileName, status: i.status, target: i.target,
      custom: i.custom ? i.custom.target + '/' + i.custom.preset : null,
      out: i.outputPath,
    });
    return {
      added: (q?.items ?? []).filter(i => !before.has(i.jobId)).map(slim),
      stillQueued: (q?.items ?? []).filter(i => before.has(i.jobId)).map(slim),
    };
  })()`);

const snapshot = () =>
  evalJs(`(async () => {
    const q = window.__appStore.getState().queue;
    return {
      paused: !!q?.paused, reason: q?.pausedReason ?? null, mode: q?.mode ?? null,
      policy: q?.policy ?? null,
      items: (q?.items ?? []).map(i => ({ name: i.fileName, status: i.status, custom: !!i.custom })),
      chips: [...document.querySelectorAll('.queue-row:not(.is-history) .chip')].map(c => c.textContent),
      banner: document.querySelector('.queue-paused .qp-title')?.textContent ?? null,
      failedRows: document.querySelectorAll('.queue-row.is-failed').length,
      editPanel: !!document.querySelector('.queue-edit'),
    };
  })()`);

const clickInRow = (fileName, text) =>
  evalJs(`(async () => {
    const rows = [...document.querySelectorAll('.queue-item')];
    const row = rows.find(r => r.querySelector('.q-fname')?.textContent === ${JSON.stringify(fileName)});
    if (!row) return 'no-row:' + rows.map(r => r.querySelector('.q-fname')?.textContent).join('|');
    const btn = [...row.querySelectorAll('.q-right button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!btn) return 'no-btn:' + [...row.querySelectorAll('.q-right button')].map(b => b.textContent.trim()).join('|');
    btn.click();
    await new Promise(r => setTimeout(r, 350));
    return 'ok';
  })()`);

const clickBanner = (text) =>
  evalJs(`(async () => {
    const btn = [...document.querySelectorAll('.queue-paused button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!btn) return 'no-btn';
    btn.click();
    await new Promise(r => setTimeout(r, 400));
    return 'ok';
  })()`);

/* ── 1. 共用全局参数模式 ───────────────────────────────── */
const left = await resetUi();
if (left !== 0) throw new Error(`清场失败，队列里还有 ${left} 个任务`);

await evalJs(`(async () => {
  const st = window.__appStore.getState();
  await st.updateSettings({ queueMode: 'shared', failurePolicy: 'pause' });
  // 目标格式 webm：这两个源都要真转码，跑得够久，便于观察「运行中 + 等待中」并存的排版
  window.__appStore.setState({ target: 'webm', outputDir: ${JSON.stringify(OUT_DIR)} });
})()`);

const batchA = await enqueue([
  path.join(FIX, 'sample-h264-aac.mp4'),
  path.join(FIX, 'sample-noaudio.mp4'),
]);
check('共用全局参数：两条都已入队', batchA.added.length === 2, JSON.stringify(batchA.added.map((i) => i.name)));
check('共用全局参数：任务不带 custom', batchA.added.every((i) => i.custom === null));
check(
  '共用全局参数：目标格式取自全局面板（webm）',
  batchA.added.every((i) => i.target === 'webm'),
);

let snap = await snapshot();
check(
  '单并发：一条在跑，其余等待',
  snap.items.some((i) => i.status !== 'pending') && snap.items.some((i) => i.status === 'pending'),
  JSON.stringify(snap.items),
);
check('卡片显示「跟随全局」标签', snap.chips.includes('跟随全局'), snap.chips.join(','));
await shot('p1-03-queue.png');

/* ── 2. 切换模式 → 只影响后续新增 ────────────────────────── */
await evalJs(`(async () => {
  const st = window.__appStore.getState();
  await st.updateSettings({ queueMode: 'per-task' });
  window.__appStore.setState({ target: 'webm' });
})()`);

const batchB = await enqueue([path.join(FIX, 'sample-h264-ac3.mkv')]);
check('切到单任务模式后，新任务自带 custom', batchB.added[0]?.custom === 'webm/standard', String(batchB.added[0]?.custom));

// 「切换只影响后续新增」：同一批里先前入队的任务仍必须没有 custom
const oldStill = await evalJs(`(async () => {
  await window.__appStore.getState().refreshQueue();
  const ids = ${JSON.stringify(batchA.added.map((i) => i.jobId))};
  const q = window.__appStore.getState().queue;
  return (q?.items ?? []).filter(i => ids.includes(i.jobId)).map(i => ({ name: i.fileName, custom: i.custom }));
})()`);
check('切模式前入队的任务仍在队列里（断言非空才有意义）', oldStill.length > 0, JSON.stringify(oldStill));
check(
  '切模式前入队的任务仍然不带 custom',
  oldStill.every((i) => i.custom === null),
  JSON.stringify(oldStill),
);

snap = await snapshot();
check('同一页面里「跟随全局」与「自定义」并存', snap.chips.includes('跟随全局') && snap.chips.includes('自定义'), snap.chips.join(','));
check('队列模式已切换', snap.mode === 'per-task', String(snap.mode));
await shot('p1-04-queue-modes.png');

/* ── 3. 单任务参数编辑 ─────────────────────────────────── */
const OPENED = await clickInRow('sample-h264-ac3.mkv', '编辑');
check('队列条目可以展开参数编辑器', OPENED === 'ok', String(OPENED));
snap = await snapshot();
check('编辑器面板已渲染', snap.editPanel === true);
await shot('p1-05-queue-edit.png');

// 改成 MP4 / 高清优先 并保存，验证输出路径跟着改扩展名
const edited = await evalJs(`(async () => {
  const panel = document.querySelector('.queue-edit');
  const chip = [...panel.querySelectorAll('.fmt-chip')].find(b => b.textContent.trim() === 'MP4');
  chip.click();
  const tier = [...panel.querySelectorAll('.segmented button')].find(b => b.textContent.trim() === '高清优先');
  tier.click();
  await new Promise(r => setTimeout(r, 120));
  const save = [...panel.querySelectorAll('button')].find(b => b.textContent.trim() === '保存');
  save.click();
  await new Promise(r => setTimeout(r, 700));
  const q = window.__appStore.getState().queue;
  const it = (q?.items ?? []).find(i => i.custom);
  return { target: it?.target, preset: it?.preset, custom: it?.custom ?? null, out: it?.outputPath };
})()`);
check('编辑后任务参数已更新', edited?.target === 'mp4' && edited?.preset === 'high', JSON.stringify(edited));
check('编辑后输出扩展名跟着变', String(edited?.out).toLowerCase().endsWith('.mp4'), String(edited?.out));

/* ── 4. 失败 → 暂停队列 ─────────────────────────────────── */
await waitFor(`(window.__appStore.getState().queue?.items ?? []).length === 0`, '前两批任务跑完', 40000);
check('前两批任务全部完成并移出队列（成功进历史）', true);

// 用一个「其实是文件」的路径当输出目录，mkdir 必然失败 —— 比依赖磁盘满/权限更确定
const blocker = path.join(ROOT, 'tests', '.tmp', 'output-blocker');
fs.mkdirSync(path.dirname(blocker), { recursive: true });
fs.writeFileSync(blocker, 'not a directory');

await evalJs(`(async () => {
  await window.__appStore.getState().updateSettings({ failurePolicy: 'pause' });
  window.__appStore.setState({ outputDir: ${JSON.stringify(blocker)} });
})()`);
await enqueue([path.join(FIX, 'sample-h264-aac.mp4')]);

await waitFor(`window.__appStore.getState().queue?.items?.some(i => i.status === 'error')`, '任务失败', 30000);
await sleep(300);

snap = await snapshot();
check('失败任务标红（.is-failed）', snap.failedRows === 1, String(snap.failedRows));
check('失败后队列自动暂停', snap.paused === true, String(snap.paused));
check('暂停原因标记为 failure', snap.reason === 'failure', String(snap.reason));
check('顶部出现暂停提示条', snap.banner === '队列已暂停', String(snap.banner));
check('失败任务留在队列里（不是静默消失）', snap.items.length === 1, JSON.stringify(snap.items));
await shot('p1-06-queue-paused.png');

/* ── 5. 删除失败任务 → 暂停解除 ─────────────────────────── */
const removed = await clickInRow('sample-h264-aac.mp4', '删除');
check('可以单独删除失败任务', removed === 'ok', String(removed));
await sleep(500);
snap = await snapshot();
check('删除后队列为空', snap.items.length === 0, JSON.stringify(snap.items));
check('删除后暂停自动解除', snap.paused === false, String(snap.paused));

// 复原：别把测试用的坏输出目录留在设置里，也把产物清掉
await evalJs(`window.__appStore.setState({ outputDir: null })`);
fs.rmSync(blocker, { force: true });
try {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
} catch (err) {
  console.warn(`⚠️  临时输出目录未能清理（不影响结论）：${OUT_DIR}\n   ${String(err)}`);
}

ws.close();
console.table(results);
console.log(`\n截图已写入 ${SHOTS}`);
