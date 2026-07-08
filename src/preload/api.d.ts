import type { Api } from './index';

/**
 * 渲染进程可见 API 的类型声明（`window.api`）。
 *
 * 直接用 preload 里 `api` 对象的推导类型，而不是手写一份声明 ——
 * 手写两份迟早不同步，然后渲染层就在「编译过、运行时 undefined」上翻车。
 * `tsc` 会替你发现漏改的通道。
 */
declare global {
  interface Window {
    api: Api;
  }
}

export {};
