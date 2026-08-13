'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BellOff,
  Eye,
  Globe2,
  Megaphone,
  Search,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { RichText } from '@/components/ui/RichText';
import { Avatar, fullTime, listTime } from '@/components/workplace/people';
import {
  PRIORITY_CARD,
  PRIORITY_TAG,
  expiryLabel,
} from '@/components/workplace/broadcast-ui';
import { cn } from '@/lib/utils';
import type { BroadcastCard, BroadcastPage } from '@/lib/types';

/** Which end of an announcement a person is looking at. */
type Side = 'to-me' | 'by-me';

/**
 * The broadcast feed — announcements as cards, newest first.
 *
 * A feed rather than the mailbox's list-beside-reader, and that is the whole
 * point: an announcement is short, so the card shows all of it and nobody has to
 * open anything. Reading one is scrolling past it, which is what the observer
 * below records; the only deliberate acts are putting one down (a reader) and
 * taking one down (the sender).
 */
export function BroadcastScreen() {
  const toast = useToast();
  const confirm = useConfirm();

  const [side, setSide] = useState<Side>('to-me');
  const [items, setItems] = useState<BroadcastCard[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [past, setPast] = useState(false);

  /**
   * The toast helpers, reachable from `load` without being a dependency of it —
   * see MailboxScreen: the context value is unmemoized, so depending on it turns
   * one failed load into a request loop.
   */
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(
    async (opts: { page: number; append: boolean }) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (search.trim()) qs.set('q', search.trim());
        if (opts.page > 1) qs.set('page', String(opts.page));
        if (past) qs.set('past', '1');
        const box = side === 'to-me' ? 'feed' : 'sent';
        const data = await api.get<BroadcastPage>(
          `/broadcasts/${box}${qs.toString() ? `?${qs}` : ''}`,
        );
        setItems((list) =>
          opts.append ? [...list, ...data.items] : data.items,
        );
        setHasMore(data.hasMore);
        setPage(opts.page);
      } catch (e) {
        toastRef.current.error(
          e instanceof Error
            ? e.message
            : 'The broadcasts could not be loaded.',
        );
      } finally {
        setLoading(false);
      }
    },
    [side, search, past],
  );

  // Typing in the search box waits for a pause rather than querying per letter.
  useEffect(() => {
    const t = setTimeout(() => void load({ page: 1, append: false }), 250);
    return () => clearTimeout(t);
  }, [load]);

  /** Scrolled past — record it once, and quietly. A failure here is not news. */
  const markSeen = useCallback((id: number) => {
    setItems((list) =>
      list.map((b) => (b.id === id ? { ...b, isRead: true } : b)),
    );
    api.post(`/broadcasts/${id}/read`).catch(() => {});
  }, []);

  const setDismissed = async (card: BroadcastCard, dismissed: boolean) => {
    try {
      await api.post(
        `/broadcasts/${card.id}/${dismissed ? 'dismiss' : 'restore'}`,
      );
      // It has moved between the live feed and the past one, so it is out of
      // whichever is on screen.
      setItems((list) => list.filter((b) => b.id !== card.id));
      toast.success(dismissed ? 'Dismissed.' : 'Back in your feed.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work.');
    }
  };

  const withdraw = async (card: BroadcastCard) => {
    const ok = await confirm({
      title: 'Take this broadcast down?',
      message:
        'It stops showing for everyone it went to. Nothing is deleted — it stays in the past list, because people have already seen it.',
      confirmText: 'Take it down',
      cancelText: 'Leave it up',
    });
    if (!ok) return;
    try {
      await api.delete(`/broadcasts/${card.id}`);
      setItems((list) => list.filter((b) => b.id !== card.id));
      toast.success('Taken down.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work.');
    }
  };

  const switchSide = (next: Side) => {
    setSide(next);
    setItems([]);
  };

  const isMineSide = side === 'by-me';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* ---------------------------------------------------------- toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          {(
            [
              { key: 'to-me', label: 'To me' },
              { key: 'by-me', label: 'Sent by me' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => switchSide(tab.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition',
                side === tab.key
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search announcements…"
            className="input-base w-full pl-8"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <input
            type="checkbox"
            checked={past}
            onChange={(e) => setPast(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
          />
          {isMineSide ? 'Finished ones' : 'Dismissed and expired'}
        </label>
      </div>

      {/* ------------------------------------------------------------- feed */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-3">
          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
              <Megaphone className="h-10 w-10" />
              <p className="text-sm">
                {search
                  ? 'No announcement matches that.'
                  : past
                    ? 'Nothing here yet.'
                    : isMineSide
                      ? 'You have not sent a broadcast yet.'
                      : 'No announcements for you right now.'}
              </p>
            </div>
          )}

          {items.map((card) => (
            <Card
              key={card.id}
              card={card}
              isMineSide={isMineSide}
              onSeen={markSeen}
              onDismiss={() => void setDismissed(card, true)}
              onRestore={() => void setDismissed(card, false)}
              onWithdraw={() => void withdraw(card)}
            />
          ))}

          {hasMore && (
            <button
              className="w-full py-3 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              disabled={loading}
              onClick={() => void load({ page: page + 1, append: true })}
            >
              {loading ? 'Loading…' : 'Load older announcements'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One announcement.
 *
 * An unread card reports itself read once it has actually been on screen — the
 * feed shows the whole text, so demanding a click to call it read would only
 * make the sender's count wrong. Half the card, for a full second: enough that
 * scrolling hard past a long feed does not mark everything read behind you.
 */
function Card({
  card,
  isMineSide,
  onSeen,
  onDismiss,
  onRestore,
  onWithdraw,
}: {
  card: BroadcastCard;
  isMineSide: boolean;
  onSeen: (id: number) => void;
  onDismiss: () => void;
  onRestore: () => void;
  onWithdraw: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const { id, isRead } = card;

  useEffect(() => {
    if (isRead || isMineSide || !ref.current) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timer = setTimeout(() => onSeen(id), 1000);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(ref.current);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [id, isRead, isMineSide, onSeen]);

  return (
    <article
      ref={ref}
      className={cn(
        'rounded-xl border p-4 transition',
        PRIORITY_CARD[card.priority],
        card.hasExpired && 'opacity-60',
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {!card.isRead && !isMineSide && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-brand-600"
              title="New"
            />
          )}
          <h3 className="truncate text-base font-semibold text-slate-900 dark:text-white">
            {card.title}
          </h3>
          {card.priority !== 'NORMAL' && (
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                PRIORITY_TAG[card.priority],
              )}
            >
              {card.priority === 'URGENT' ? 'Urgent' : 'Important'}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isMineSide ? (
            !card.hasExpired && (
              <button
                className="btn-secondary px-2 py-1 text-xs"
                onClick={onWithdraw}
                title="Stop showing it to everyone"
              >
                <BellOff className="mr-1 inline h-3.5 w-3.5" />
                Take down
              </button>
            )
          ) : card.dismissedAt ? (
            <button
              className="btn-secondary px-2 py-1 text-xs"
              onClick={onRestore}
              title="Put it back in my feed"
            >
              <Undo2 className="mr-1 inline h-3.5 w-3.5" />
              Bring back
            </button>
          ) : (
            <button
              className="btn-secondary px-2 py-1 text-xs"
              onClick={onDismiss}
              title="Clear it from my feed"
            >
              <X className="mr-1 inline h-3.5 w-3.5" />
              Dismiss
            </button>
          )}
        </div>
      </div>

      {card.body && (
        <RichText
          html={card.body}
          className="text-sm text-slate-700 dark:text-slate-200"
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-200/70 pt-2.5 text-xs text-slate-500 dark:border-slate-700/60 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <Avatar name={card.senderName} id={card.senderId} size="sm" />
          {card.isMine ? 'You' : card.senderName}
        </span>
        <span title={fullTime(card.sentAt)}>{listTime(card.sentAt)}</span>
        <span className="text-slate-400">·</span>
        <span>{expiryLabel(card.expiresAt, card.hasExpired)}</span>

        {isMineSide && (
          <>
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {card.audienceLabels.length > 0 && (
                <>
                  {card.audienceLabels.some((l) =>
                    l.startsWith('Everyone'),
                  ) && <Globe2 className="h-3 w-3" />}
                  {card.audienceLabels.join(', ')}
                </>
              )}
            </span>
            <span className="flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              Seen by {card.readCount} of {card.recipientCount}
            </span>
            {card.dismissedCount > 0 && (
              <span>{card.dismissedCount} dismissed</span>
            )}
          </>
        )}

        {!isMineSide && card.dismissedAt && (
          <span>Dismissed {listTime(card.dismissedAt)}</span>
        )}
      </div>
    </article>
  );
}
