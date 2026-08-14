import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/** What the server pushes down an open alert stream. */
export type NotificationEventType =
  | 'alert.new'
  /** Alerts that have stopped standing — by id, so the client drops them. */
  | 'alert.stale'
  | 'ping';

export interface NotificationEvent {
  type: NotificationEventType;
  /** Event payload — always JSON-serializable; it crosses the wire as text. */
  data: unknown;
}

/**
 * Live delivery for alerts: who has a bell open, and how one reaches it the
 * moment it is raised.
 *
 * Server-Sent Events again, and deliberately a SECOND hub rather than chat's —
 * the two modules must stay independently extractable, and one shared hub is
 * the import that would weld them together (`npm run lint:boundaries` would
 * refuse it). The duplication is forty lines of Map bookkeeping; the coupling
 * would be permanent.
 *
 * IN-MEMORY, SINGLE-INSTANCE, and best-effort by design: every alert is a row
 * in the database first, so a missed push costs a reader nothing — the bell
 * polls its count and the feed refetches on reconnect. Scaling out means putting
 * a shared bus (Redis pub/sub, or Postgres LISTEN/NOTIFY) behind `emit`; no call
 * site moves.
 */
@Injectable()
export class NotificationEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationEventsService.name);

  /** userId → their open streams (one per tab, phone, or window). */
  private readonly listeners = new Map<
    number,
    Set<Subject<NotificationEvent>>
  >();

  /**
   * Open a stream for one user. The returned Observable completes when the
   * caller unsubscribes, which is what an HTTP disconnect does — so a closed tab
   * removes itself and nothing accumulates.
   */
  subscribe(userId: number): Observable<NotificationEvent> {
    const subject = new Subject<NotificationEvent>();
    const set = this.listeners.get(userId) ?? new Set();
    set.add(subject);
    this.listeners.set(userId, set);

    return new Observable<NotificationEvent>((subscriber) => {
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

  /** Push an event to each of the given users; offline ones are skipped. */
  emit(userIds: number[], event: NotificationEvent): void {
    for (const userId of new Set(userIds)) {
      const set = this.listeners.get(userId);
      if (!set) continue;
      for (const subject of set) {
        try {
          subject.next(event);
        } catch (e) {
          // One broken stream must not stop delivery to the other recipients.
          this.logger.warn(
            `alert stream delivery failed for user ${userId}: ${String(e)}`,
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
