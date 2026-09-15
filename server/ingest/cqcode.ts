/**
 * CQ 码解析与清洗
 *
 * OneBot 11 的 raw_message 使用 CQ 码描述富媒体，例如：
 *   [CQ:at,qq=123456]你好[CQ:image,file=abc.jpg][CQ:face,id=13]
 *
 * 本模块把 CQ 码转成「可读纯文本 + 媒体列表」，便于入库与交给 AI 总结。
 */
import type { UnifiedMedia } from '../adapters/types.js';

/** 匹配一个 CQ 码： [CQ:type,key=value,...] */
const CQ_REGEX = /\[CQ:([a-zA-Z_]+)((?:,[^\]]*)?)\]/g;

function parseCqParams(paramStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!paramStr) return out;
  const body = paramStr.startsWith(',') ? paramStr.slice(1) : paramStr;
  for (const part of body.split(',')) {
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1);
    out[key] = decodeCqValue(value);
  }
  return out;
}

/** CQ 码值中的转义还原 */
function decodeCqValue(value: string): string {
  return value
    .replace(/&#44;/g, ',')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&amp;/g, '&');
}

export interface ParsedCq {
  /** 清洗后的纯文本 */
  text: string;
  /** 提取出的媒体 */
  media: UnifiedMedia[];
  /** 是否 @ 了指定人（selfId） */
  isAtSelf: boolean;
  /** 是否 @ 全体成员 */
  isAtAll: boolean;
}

/**
 * 解析 CQ 码字符串
 * @param raw 原始消息（可能含 CQ 码）
 * @param selfId 机器人自身 QQ 号，用于判断是否 @ 了自己
 * @param nameResolver 可选的 QQ → 昵称解析（用于 @ 显示）
 */
export function parseCqCode(
  raw: string,
  selfId?: string,
  nameResolver?: (qq: string) => string | undefined
): ParsedCq {
  const media: UnifiedMedia[] = [];
  let isAtSelf = false;
  let isAtAll = false;

  const text = raw.replace(CQ_REGEX, (_match, type: string, paramStr: string) => {
    const params = parseCqParams(paramStr);
    switch (type) {
      case 'at': {
        const qq = params.qq || '';
        if (qq === 'all') {
          isAtAll = true;
          return '@全体成员';
        }
        if (selfId && qq === selfId) isAtSelf = true;
        const name = nameResolver?.(qq);
        return `@${name || qq}`;
      }
      case 'image':
      case 'flash':
        media.push({ type: 'image', url: params.url, file: params.file });
        return '[图片]';
      case 'record':
      case 'voice':
        media.push({ type: 'voice', url: params.url, file: params.file });
        return '[语音]';
      case 'video':
        media.push({ type: 'video', url: params.url, file: params.file });
        return '[视频]';
      case 'file':
        media.push({ type: 'file', url: params.url, file: params.file });
        return `[文件:${params.name || '未知'}]`;
      case 'face':
        return '[表情]';
      case 'mface':
        return '[表情]';
      case 'reply':
        return '[回复]';
      case 'forward':
        return '[合并转发]';
      case 'json':
        return '[卡片消息]';
      case 'xml':
        return '[卡片消息]';
      case 'music':
        return '[音乐分享]';
      case 'poke':
        return '[戳一戳]';
      case 'shake':
        return '[窗口抖动]';
      default:
        return '';
    }
  });

  return {
    text: normalizeText(text),
    media,
    isAtSelf,
    isAtAll,
  };
}

/**
 * 文本清洗：
 * - 折叠连续空白
 * - 去掉首尾空白
 * - 移除零宽字符
 */
export function normalizeText(input: string): string {
  return input
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 判断消息是否属于「无意义」内容（纯媒体占位、空串等），用于过滤 */
export function isNoiseContent(content: string): boolean {
  const stripped = content.replace(/\[(图片|表情|语音|视频|文件:[^\]]*|卡片消息|合并转发|回复|戳一戳|窗口抖动|音乐分享)\]/g, '').trim();
  return stripped.length === 0;
}
