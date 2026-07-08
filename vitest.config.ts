/**
 * Vitest 配置。
 *
 * 单独一个文件而不是复用 vite.config.ts：后者的 root 指向 src/renderer，
 * 直接复用会让测试文件的相对路径全部错位。
 *
 * 分层：tests/unit 是纯函数（毫秒级），tests/integration 会真的起 ffmpeg 子进程。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 集成测试要真的转码，给足时间；超时了宁可报错也不要假通过
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // 集成测试共用 tests/.tmp 目录，并行跑会互相删临时文件。
    // 串行换来的确定性比那几秒钟更值钱。
    fileParallelism: false,
    reporters: ['default'],
  },
});
