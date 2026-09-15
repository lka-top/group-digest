/**
 * 平台适配器工厂
 *
 * 根据 `ADAPTER` 环境变量选择具体实现，并对外暴露单例。
 * 新增平台时，只需在此注册一个新的 Adapter 实现即可。
 */
import config from '../config.js';
import type { PlatformAdapter } from './types.js';
import { OneBot11Adapter } from './onebot11.js';

export type { PlatformAdapter } from './types.js';
export * from './types.js';

let instance: PlatformAdapter | null = null;

type AdapterConstructor = new () => PlatformAdapter;

async function createAdapter(): Promise<PlatformAdapter> {
  if (config.adapter === 'onebot11') return new OneBot11Adapter();

  const localModulePath = process.env.LOCAL_ADAPTER_MODULE?.trim();
  if (!localModulePath) {
    throw new Error(`未公开的本地适配器「${config.adapter}」需要配置 LOCAL_ADAPTER_MODULE`);
  }
  if (!/^\.\/[A-Za-z0-9._-]+\.ts$/.test(localModulePath)) {
    throw new Error('LOCAL_ADAPTER_MODULE 必须是 adapters 目录下的相对 TypeScript 文件');
  }

  const localModule = (await import(localModulePath)) as { default?: AdapterConstructor };
  if (typeof localModule.default !== 'function') {
    throw new Error(`本地适配器模块「${localModulePath}」没有默认导出适配器类`);
  }
  return new localModule.default();
}

/** 准备当前适配器；本地测试实现通过未提交的模块按需加载。 */
export async function prepareAdapter(): Promise<PlatformAdapter> {
  if (!instance) {
    instance = await createAdapter();
    console.log(`[adapter] 已选择平台适配器: ${instance.platform}`);
  }
  return instance;
}

/** 获取当前适配器单例（不启动） */
export function getAdapter(): PlatformAdapter {
  if (!instance) throw new Error('平台适配器尚未完成初始化');
  return instance;
}

/** 启动适配器 */
export async function startAdapter(): Promise<PlatformAdapter> {
  const adapter = await prepareAdapter();
  await adapter.init();
  await adapter.start();
  return adapter;
}

/** 停止适配器 */
export async function stopAdapter(): Promise<void> {
  if (!instance) return;
  await instance.stop();
}

export { OneBot11Adapter };
