import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/** What the server pushes down an open stream. */
export type ChatEventType =
  | 'message.new'
  | 'message.updated'
  | 'message.deleted'
  | 'conversation.new'
  | 'conversation.updated'
  | 'conversation.read'
  | 'typing'
  | 'ping';

export interface ChatEvent {
  type: ChatEventType;
  /** Event payload — always JSON-serializable; it crosses the wire as text. */
  data: unknown;
}

/**
 * The live delivery hub: who is listening, and how a message reaches them the
 * moment it is written.
 *
 * Transport is Server-Sent Events (see ChatController.stream) rather than
 * websockets, and that is a deliberate choice, not a shortcut:
 *  - It needs NO new dependency. The dev compose keeps node_modules in an
 *    anonymous volume (`- /app/node_modules`), so every added package costs an
 *    image rebuild for each developer.
 *  - Chat is overwhelmingly one-directional — the server pushes, and the few
 *    client-to-server events (send, typing, read) are ordinary POSTs that want
 *    the normal auth, validation and error handling anyway.
 *  - EventSource-shaped streams are consumable from a native mobile client too,
 *    which the second phase needs.
 * If bidirectional presence later earns its keep, only this file and the
 * controller's stream endpoint change — nothing else knows how delivery works.
 *
 * IN-MEMORY, SINGLE-INSTANCE. Subscribers live in this process's Map, so two
 * backend replicas would each only reach their own connections. Scaling out
 * means putting a shared bus (Redis pub/sub, or Postgres LISTEN/NOTIFY, which
 * needs no new infrastructure here) behind `emit` — the call sites do not move.
 */
@Injectable()
export class ChatEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(ChatEventsService.name);

  /** userId → their open streams (one per tab, phone, or window). */
  private readonly listeners = new Map<number, Set<Subject<ChatEvent>>>();

  /**
   * Open a stream for one user. The returned Observable completes when the
   * caller unsubscribes, which is what HTTP disconnect does — so a closed tab
   * removes itself and nothing accumulates.
   */
  subscribe(userId: number): Observable<ChatEvent> {
    const subject = new Subject<ChatEvent>();
    const set = this.listeners.get(userId) ?? new Set();
    set.add(subject);
    this.listeners.set(userId, set);

    return new Observable<ChatEvent>((subscriber) => {
      const sub = subject.subscribe(subscriber);
      return () => {
        sub.unsubscribe();
        const live = this.listeners.get(userId);
        if (!live) return;
        live.delete(subject);
        // Drop the key rather than leave an empty Set behind — this Map is
        // keyed by every user who has ever connected.
        if (live.size === 0) this.listeners.delete(userId);
      };
    });
  }

  /** True if the user has at least one stream open right now. */
  isOnline(userId: number): boolean {
    return (this.listeners.get(userId)?.size ?? 0) > 0;
  }

  /**
   * Push an event to each of the given users. Unknown or offline users are
   * skipped silently — delivery is best-effort by design: the thread itself is
   * in the database, and a client that missed an event refetches on reconnect.
   */
  emit(userIds: number[], event: ChatEvent): void {
    for (const userId of new Set(userIds)) {
      const set = this.listeners.get(userId);
      if (!set) continue;
      for (const subject of set) {
        try {
          subject.next(event);
        } catch (e) {
          // One broken stream must not stop delivery to the other recipients.
          this.logger.warn(
            `chat stream delivery failed for user ${userId}: ${String(e)}`,
          );
        }
      }
    }
  }

  onModuleDestroy(): void {
    for (const set of this.listeners.values()) {
      for (const subject of set) subject.complete();
    }
    this.listeners.clear();
  }
}
