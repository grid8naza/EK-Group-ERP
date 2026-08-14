'use client';

import { ServerEvent, useEventStream } from './useEventStream';

/** Everything the server pushes down the chat stream. */
export type ChatStreamEvent = ServerEvent;

/**
 * Subscribe to the server's chat stream, and call `onEvent` for each event.
 *
 * The transport itself now lives in useEventStream — alerts push over the same
 * kind of stream, and one parser for SSE framing, auth and reconnection is
 * enough. This wrapper stays because callers name what they are listening to,
 * not where it comes from.
 */
export function useChatStream(
  onEvent: (event: ChatStreamEvent) => void,
  onReconnect?: () => void,
) {
  useEventStream('/chat/stream', onEvent, onReconnect);
}
