import { useEffect, useRef } from 'react';
import type { AppEventPayload } from '../types';

/**
 * 订阅后端全局事件流（/api/events）
 */
export function useEvents(onEvent: (event: AppEventPayload) => void): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as AppEventPayload;
        handlerRef.current(data);
      } catch {
        /* 忽略解析错误 */
      }
    };
    source.onerror = () => {
      // 浏览器会自动重连，这里不额外处理
    };
    return () => source.close();
  }, []);
}
