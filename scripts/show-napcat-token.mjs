import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(projectRoot, 'deploy/napcat/data/config/webui.json');
const envPath = resolve(projectRoot, 'deploy/napcat/.env');

let token = '';
let source = '';

if (existsSync(configPath)) {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (typeof config.token === 'string' && config.token.trim()) {
      token = config.token.trim();
      source = 'deploy/napcat/data/config/webui.json';
    }
  } catch (error) {
    console.warn(`[NapCat] 无法解析 WebUI 配置：${error instanceof Error ? error.message : String(error)}`);
  }
}

if (!token) {
  dotenv.config({ path: envPath });
  token = process.env.WEBUI_TOKEN?.trim() || 'napcat';
  source = process.env.WEBUI_TOKEN ? 'deploy/napcat/.env' : 'Compose 兼容默认值';
}

console.log('');
console.log('┌─ NapCat WebUI ─────────────────────────────────────');
console.log('│ 地址:  http://127.0.0.1:6099/webui');
console.log(`│ Token: ${token}`);
console.log(`│ 来源:  ${source}`);
console.log('│ 注意:  这是本机管理密钥，请勿粘贴到聊天、截图或公共日志。');
console.log('└────────────────────────────────────────────────────');
console.log('');
