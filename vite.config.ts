import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 全部用 import.meta.url 换算绝对路径：
// 1) Vite 8 的原生配置加载器不支持 __dirname；
// 2) 渲染进程的 root 改到 src/renderer 后，插件内部仍以 root 为基准解析相对入口，
//    所以主进程 / preload 的入口必须给绝对路径，否则会被解析成 src/renderer/src/main/index.ts。
const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url))
/** 项目根目录（vite.config.ts 所在目录） */
const projectRoot = abs('./')

export default defineConfig(({ command }) => ({
  // 渲染层根目录 = src/renderer（与《方案设计文档》§5 的目录结构一致）
  root: abs('./src/renderer'),
  // 打包后页面通过 file:// 加载，必须用相对路径，否则 /assets/* 会 404；
  // 开发态仍是根路径 '/'，相对 base 会让 dev server 的资源解析出岔子。
  base: command === 'build' ? './' : '/',
  build: {
    // 相对 root 会被解析成 src/renderer/dist，这里显式指回项目根下的 dist
    outDir: abs('./dist'),
    emptyOutDir: true,
  },
  plugins: [
    react(),
    // Tailwind 4 走 Vite 插件（无 tailwind.config.js），
    // 设计 Token 用 @theme 声明在 styles/main.css 里
    tailwindcss(),
    electron({
      main: {
        entry: abs('./src/main/index.ts'),
        // ⚠️ 必须自定义 onstart：
        // vite-plugin-electron 默认拿 vite 的 root 当 electron 进程的 cwd（见其源码 triggerStartup）。
        // 本项目的 root 是 src/renderer，那里没有 package.json，`electron .` 会直接弹
        // 「Unable to find Electron app」的错误对话框并以退出码 1 结束，表现就是
        // 窗口标题变成 "Error"、`pnpm dev` 直接失败、主进程一行日志都没有。
        // 这里显式把 cwd 指回项目根。
        onstart({ startup }) {
          // 需要远程调试（CDP 截图 / 驱动界面）时用环境变量开启，脚本见 scripts/cdp-*.mjs：
          //   CDP_PORT=9222 pnpm dev
          // 走环境变量而不是临时改代码，是为了让截图脚本可复现、也避免忘记还原。
          const flags = ['.', '--no-sandbox'];
          if (process.env.CDP_PORT) flags.push(`--remote-debugging-port=${process.env.CDP_PORT}`);
          startup(flags, { cwd: projectRoot })
        },
        vite: {
          build: {
            // 不显式指定的话，outDir 会按 root（src/renderer）解析，产物落错地方
            outDir: abs('./dist-electron'),
            emptyOutDir: false, // main 与 preload 分两次构建，清空会互相删掉对方
            // ⚠️ 主进程必须输出 CJS（.cjs 后缀）：
            // package.json 里是 "type": "module"，若产物叫 main.js 会被 Node 当 ESM 解析，
            // 而 electron 包本身是 CJS，无法提供 BrowserWindow / app 等具名导出，
            // 启动即报 "does not provide an export named 'BrowserWindow'"。
            //
            // 注意：main 走的是 build.lib 模式，产物文件名与格式由 lib.fileName / lib.formats
            // 决定，写在 rollupOptions.output 里会被忽略（preload 不是 lib 模式，那边可以）。
            lib: {
              entry: abs('./src/main/index.ts'),
              formats: ['cjs'],
              fileName: () => 'main.cjs',
            },
          },
        },
      },
      preload: {
        // preload 可能包含 Web 资源，用 rollupOptions.input 而不是 build.lib.entry
        input: abs('./src/preload/index.ts'),
        vite: {
          build: {
            outDir: abs('./dist-electron'),
            emptyOutDir: false,
            rollupOptions: {
              output: {
                // ⚠️ 必须输出 CJS：
                // 主进程开了 sandbox: true，而 Electron 的沙箱化 preload 不支持 ESM。
                // 默认产物是 .mjs，加载时会直接报错，所以这里强制 cjs + .cjs 后缀。
                format: 'cjs',
                entryFileNames: 'preload.cjs',
              },
            },
          },
        },
      },
      // 不启用 renderer 端 Node.js polyfill：
      // 渲染进程是纯展示层（nodeIntegration: false / sandbox: true），
      // 不需要也不应该拿到 Node API。
    }),
  ],
}))
