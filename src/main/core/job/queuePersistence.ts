/**
 * 队列快照存储（纯 Node，不 import electron，可直接单测）。
 *
 * 为什么单独存一个 `queue.json`，而不是塞进 `settings`：
 *   · 它是**高频写**（每次队列变动一次），设置是低频写，混在一起会让配置文件
 *     每几百毫秒被重写一遍，而设置里还有窗口偏好这种不希望被覆盖的东西；
 *   · 它的生命周期是「会话级」——正常退出就删掉，只有崩溃才留下，
 *     这个语义放进设置里根本表达不出来。
 *
 * 三条硬规则：
 *   1. 只存**还没跑完**的（pending / 正在跑被标记 interrupted）与失败的（error）；
 *      成功与取消的任务已经进历史，再恢复一次等于重复劳动
 *   2. 顺序**即原数组顺序**：`pending` 的先后就是用户排的队（TODO-13 之后还能手动调整），
 *      这里一旦排序，重启后体验就崩一半
 *   3. 文件坏了按空队列处理：这是「增强」，不是「依赖」
 */
import type { PersistedQueueItem, QueueFile } from '../../../shared/types';
import { deleteJsonFile, readJsonFile, writeJsonFile } from '../fs/jsonFile';

export const QUEUE_FILE_VERSION = 1;

/**
 * 恢复条数上限。
 *
 * 队列本来就有 10 个一批的上限，放宽到 50 是为了给「连续几批没跑完」留余量，
 * 再有多的说明是异常数据（比如手改过的文件），不该让用户一睁眼看到几百条。
 */
export const QUEUE_ITEM_LIMIT = 50;

/** 一条记录最小校验：jobId / 源路径 / 输出路径 / 目标参数齐了才能重跑 */
function isItem(e: unknown): e is PersistedQueueItem {
  if (!e || typeof e !== 'object') return false;
  const v = e as Partial<PersistedQueueItem>;
  return (
    typeof v.jobId === 'string' &&
    !!v.jobId &&
    !!v.meta &&
    typeof v.meta === 'object' &&
    typeof v.meta.path === 'string' &&
    !!v.meta.path &&
    typeof v.meta.fileName === 'string' &&
    typeof v.outputPath === 'string' &&
    !!v.outputPath &&
    typeof v.target === 'string'
  );
}

/** 补齐可选字段：旧数据缺 `interrupted` / `createdAt` 也能用，不因为它丢掉整条 */
function normalize(e: PersistedQueueItem): PersistedQueueItem {
  const status = e.status === 'error' ? 'error' : 'pending';
  return {
    ...e,
    status,
    audio: e.audio ?? null,
    custom: e.custom ?? null,
    outputDir: e.outputDir ?? null,
    interrupted: e.interrupted === true,
    createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now(),
  };
}

export class QueuePersistence {
  constructor(private readonly file: string) {}

  get filePath(): string {
    return this.file;
  }

  /**
   * 读出待恢复的任务，顺序与落盘时一致。
   *
   * 文件不存在 = 上次是正常退出，返回空列表即可；
   * 损坏 / 结构不对也走同一条路——这时候用户最需要的是「先能用起来」。
   */
  read(): PersistedQueueItem[] {
    const raw = readJsonFile<Partial<QueueFile>>(this.file);
    if (!raw || !Array.isArray(raw.items)) return [];
    return raw.items.filter(isItem).map(normalize).slice(0, QUEUE_ITEM_LIMIT);
  }

  /** 写一份快照；列表为空时删掉文件（等价于「此刻没有需要恢复的东西」） */
  write(items: PersistedQueueItem[]): void {
    if (items.length === 0) {
      this.clear();
      return;
    }
    const data: QueueFile = { version: QUEUE_FILE_VERSION, savedAt: Date.now(), items };
    writeJsonFile(this.file, data);
  }

  /** 删除快照文件（正常退出时调用，保证下次启动是干净的空队列） */
  clear(): void {
    deleteJsonFile(this.file);
  }
}
