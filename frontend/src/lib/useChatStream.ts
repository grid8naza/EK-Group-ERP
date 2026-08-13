'use client';

import { useEffect, useRef } from 'react';
import { API_URL, getToken } from './api';

/** Everything the server pushes down the chat stream. */
export interface ChatStreamEvent {
  type: string;
  data: unknown;
}

/** Longest wait between reconnection attempts. */
const MAX_BACKOFF_MS = 15_000;

/**
 * Subscribe to the server's chat stream, and call `onEvent` for each event.
 *
 * Read with fetch + a ReadableStream rather than the browser's EventSource,
 * because EventSource cannot set headers — and this app's auth is a bearer
 * token, with the active company in `X-Company-Id`. The alternative is a token
 * in the query string, which lands in proxy and server logs. So the SSE framing
 * is parsed here (it is four lines of it) and every request in the app keeps
 * carrying its credentials the same way.
 *
 * Reconnects with exponential backoff, and calls `onReconnect` when a new
 * stream opens after a broken one — the caller refetches there, since anything
 * that happened while the connection was down was never delivered.
 */
export function useChatStream(
  onEvent: (event: ChatStreamEvent) => void,
  onReconnect?: () => void,
) {
  // Held in refs so a re-render (which makes fresh callbacks) never tears down
  // and re-opens a working stream.
  const eventRef = useRef(onEvent);
  const reconnectRef = useRef(onReconnect);
  eventRef.current = onEvent;
  reconnectRef.current = onReconnect;

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    let abort = new AbortController();
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let opened = false;

    const connect = async () => {
      if (stopped) return;
      abort = new AbortController();
      try {
        const res = await fetch(`${API_URL}/chat/stream`, {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
          signal: abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

        // A stream that opens after an earlier one died means there is a gap to
        // close; the first connection of the page has nothing to catch up on.
        if (opened) reconnectRef.current?.();
        opened = true;
        attempt = 0;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line; anything after the last
          // one is a partial frame and stays in the buffer for the next chunk.
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            let type = 'message';
            const dataLines: string[] = [];
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) type = line.slice(6).trim();
              else if (line.startsWith('data:'))
                dataLines.push(line.slice(5).trim());
              // ':' comment lines (keep-alives) and 'id:' are ignored.
            }
            if (!dataLines.length) continue;
            if (type === 'ping') continue;
            try {
              eventRef.current({
                type,
                data: JSON.parse(dataLines.join('\n')),
              });
            } catch {
              // A frame we cannot parse is dropped rather than killing the
              // stream — the next one is very likely fine.
            }
          }
        }
        throw new Error('stream closed');
      } catch (e) {
        if (stopped || abort.signal.aborted) return;
        // Back off, so a backend that is down is not hammered by every open tab.
        const wait = Math.min(1000 * 2 ** attempt++, MAX_BACKOFF_MS);
        timer = setTimeout(connect, wait);
      }
    };

    void connect();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      abort.abort();
    };
  }, []);
}
