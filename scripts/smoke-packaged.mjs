/**
 * 打包产物冒烟测试：验证「安装包里的应用」能真正定位并调用随包分发的 FFmpeg。
 *
 * 开发态跑通不代表打包态跑通 —— 两者的二进制路径完全不同：
 *   开发态：<appPath>/resources/bin/win32-x64/
 *   打包态：<resourcesPath>/bin/win32-x64/          （extraResources 映射而来）
 * 这个脚本直接连上打包后应用的 CDP 端口，通过 window.api 走一遍
 * 探测 → 规划 → 真实转换 → 校验 的完整链路。
 *
 * 用法：
 *   node scripts/smoke-packaged.mjs [端口] [样例视频]
 * 前提：release/<ver>/win-unpacked/VideoConverter.exe --no-sandbox --remote-debugging-port=9223
 */
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.argv[2] || process.env.CDP_PORT || 9223);
const SAMPLE =
  process.argv[3] ||
  path.resolve('tests/fixtures/sample-h264-aac.mp4');
const OUT_DIR = path.resolve('tests/.tmp/packaged');
fs.mkdirSync(OUT_DIR, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('没有找到页面目标，应用是否以 --remote-debugging-port 启动？');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
  else p.resolve(msg.result);
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');

/** 在页面里跑一段异步流程，等它自己 resolve */
async function run(body) {
  const expr = `(async () => { ${body} })()`;
  const res = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? '页面内执行异常');
  }
  return res.result?.value;
}

const SAMPLE_JSON = JSON.stringify(SAMPLE.replace(/\\/g, '/'));
const OUT_JSON = JSON.stringify(OUT_DIR.replace(/\\/g, '/'));

const result = await run(`
  const out = {};
  // ① 引擎自检：打包后这里读的是 resources/bin/win32-x64/
  const capsRes = await window.api.capabilities(true);
  out.caps = capsRes.ok ? capsRes.data : { error: capsRes.error };
  if (!capsRes.ok || !capsRes.data.ffmpeg.ok) return out;

  // ② 探测
  const probeRes = await window.api.probe(${SAMPLE_JSON});
  if (!probeRes.ok) { out.probeError = probeRes.error; return out; }
  out.meta = {
    durationSec: probeRes.data.durationSec,
    video: probeRes.data.video && probeRes.data.video.codec,
    audio: probeRes.data.audio && probeRes.data.audio.codec,
  };

  // ③ 规划：H.264+AAC → WebM 必然重编码
  const prev = await window.api.preview(probeRes.data, 'webm', ${OUT_JSON});
  if (!prev.ok) { out.planError = prev.error; return out; }
  out.plan = { mode: prev.data.plan.mode, outputPath: prev.data.outputPath };

  // ④ 真实转换：等终态事件
  const started = await window.api.start(probeRes.data, 'webm', ${OUT_JSON});
  if (!started.ok) { out.startError = started.error; return out; }
  out.outputPath = started.data.outputPath;

  const terminal = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ status: 'timeout' }), 120000);
    const off = window.api.onState((s) => {
      if (s.status === 'done' || s.status === 'error' || s.status === 'cancelled') {
        clearTimeout(timer); off(); resolve({ status: s.status });
      }
    });
  });
  out.terminal = terminal;
  const st = await window.api.status();
  out.snapshot = st.ok ? { status: st.data.status, result: st.data.result, error: st.data.error } : st.error;
  return out;
`);

console.log(JSON.stringify(result, null, 2));

// 磁盘侧独立复核：文件真的存在、体积不为 0
if (result?.outputPath) {
  const exists = fs.existsSync(result.outputPath);
  console.log('\n磁盘复核:', {
    outputPath: result.outputPath,
    exists,
    sizeBytes: exists ? fs.statSync(result.outputPath).size : 0,
  });
  const part = result.outputPath.replace(/\.(\w+)$/, '.part.$1');
  console.log('残留 .part:', fs.existsSync(part));
}

ws.close();
