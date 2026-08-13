'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  Clock,
  Globe2,
  Paperclip,
  Search,
  Users,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { RichText } from '@/components/ui/RichText';
import { DraftList } from '@/components/workplace/DraftList';
import {
  Avatar,
  fileUrl,
  fullTime,
  humanSize,
  listTime,
} from '@/components/workplace/people';
import { cn } from '@/lib/utils';
import type {
  Circular,
  CircularListItem,
  CircularPage,
  SavedCircularDraft,
} from '@/lib/types';

/** Which end of a circular a person is looking at. */
type Side = 'to-me' | 'by-me' | 'drafts';

/**
 * The circular archive — the list on the left, the notice you picked on the
 * right.
 *
 * One screen for both ends of it, because they are the same notice read from
 * opposite sides: what you were issued (and owe an acknowledgement for) and what
 * you issued (and are owed acknowledgements on). The register is what differs,
 * and it is the issuer's alone.
 */
export function CircularScreen() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [side, setSide] = useState<Side>('to-me');
  const [items, setItems] = useState<CircularListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [archived, setArchived] = useState(false);

  const [drafts, setDrafts] = useState<SavedCircularDraft[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [circular, setCircular] = useState<Circular | null>(null);
  const [note, setNote] = useState('');
  const [acking, setAcking] = useState(false);

  /**
   * The toast helpers, reachable from `load` without being a dependency of it —
   * see MailboxScreen: the context value is unmemoized, so depending on it turns
   * one failed load into a request loop.
   */
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // ------------------------------------------------------------- loading --

  const load = useCallback(
    async (opts: { page: number; append: boolean }) => {
      setLoading(true);
      try {
        // Drafts are not circulars yet — no search, no paging, no archive.
        if (side === 'drafts') {
          setDrafts(await api.get<SavedCircularDraft[]>('/circulars/drafts'));
          setItems([]);
          setHasMore(false);
          return;
        }
        const qs = new URLSearchParams();
        if (search.trim()) qs.set('q', search.trim());
        if (opts.page > 1) qs.set('page', String(opts.page));
        if (archived) qs.set('archived', '1');
        if (side === 'to-me' && pendingOnly) qs.set('pending', '1');
        const box = side === 'to-me' ? 'received' : 'issued';
        const data = await api.get<CircularPage>(
          `/circulars/${box}${qs.toString() ? `?${qs}` : ''}`,
        );
        setItems((list) =>
          opts.append ? [...list, ...data.items] : data.items,
        );
        setHasMore(data.hasMore);
        setPage(opts.page);
      } catch (e) {
        toastRef.current.error(
          e instanceof Error ? e.message : 'The circulars could not be loaded.',
        );
      } finally {
        setLoading(false);
      }
    },
    [side, search, pendingOnly, archived],
  );

  // Typing in the search box waits for a pause rather than querying per letter.
  useEffect(() => {
    const t = setTimeout(() => void load({ page: 1, append: false }), 250);
    return () => clearTimeout(t);
  }, [load]);

  // ---------------------------------------------------------------- open --

  const open = async (row: CircularListItem) => {
    setOpenId(row.id);
    setNote('');
    try {
      const full = await api.get<Circular>(`/circulars/${row.id}`);
      setCircular(full);
      // Opening it marks it read on the server; mirror that in the row rather
      // than re-fetching the whole list for one boolean.
      if (!row.isRead) {
        setItems((list) =>
          list.map((c) => (c.id === row.id ? { ...c, isRead: true } : c)),
        );
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'That circular could not be opened.',
      );
      setOpenId(null);
    }
  };

  /** Put the open notice down — nothing changes, the pane just empties. */
  const closeOpen = () => {
    setCircular(null);
    setOpenId(null);
    setNote('');
  };

  /** Replace the open notice and its row, after an action changed both. */
  const adopt = (updated: Circular) => {
    setCircular(updated);
    setItems((list) =>
      list.map((c) =>
        c.id === updated.id
          ? {
              ...c,
              readCount: updated.readCount,
              ackCount: updated.ackCount,
              archivedAt: updated.archivedAt,
              acknowledgedAt: updated.me?.acknowledgedAt ?? null,
              isRead: updated.me ? updated.me.readAt !== null : true,
            }
          : c,
      ),
    );
  };

  const acknowledge = async () => {
    if (!circular || acking) return;
    setAcking(true);
    try {
      const updated = await api.post<Circular>(
        `/circulars/${circular.id}/acknowledge`,
        { note: note.trim() || undefined },
      );
      adopt(updated);
      setNote('');
      toast.success('Acknowledged.');
      // It has left the outstanding list, so that view must not still show it.
      if (pendingOnly) {
        setItems((list) => list.filter((c) => c.id !== updated.id));
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'That could not be acknowledged.',
      );
    } finally {
      setAcking(false);
    }
  };

  const setArchivedState = async (archive: boolean) => {
    if (!circular) return;
    if (archive) {
      const ok = await confirm({
        title: 'Archive this circular?',
        message:
          'It leaves the live lists for everyone it was issued to. Nothing is deleted — the notice and its register stay in the archive.',
        confirmText: 'Archive',
        cancelText: 'Keep it live',
      });
      if (!ok) return;
    }
    try {
      const updated = await api.post<Circular>(
        `/circulars/${circular.id}/${archive ? 'archive' : 'unarchive'}`,
      );
      setCircular(updated);
      // It has moved between the live list and the archive — so it is out of
      // whichever one is on screen.
      setItems((list) => list.filter((c) => c.id !== updated.id));
      setOpenId(null);
      toast.success(
        archive ? 'Moved to the archive.' : 'Back on the live list.',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work.');
    }
  };

  const switchSide = (next: Side) => {
    setSide(next);
    setItems([]);
    setCircular(null);
    setOpenId(null);
    if (next !== 'to-me') setPendingOnly(false);
  };

  /** Throw an unissued circular away. Nothing went out, so nothing is withdrawn. */
  const deleteDraft = async (id: number) => {
    try {
      await api.delete(`/circulars/drafts/${id}`);
      setDrafts((list) => list.filter((d) => d.id !== id));
      toast.success('Draft deleted.');
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'The draft could not be deleted.',
      );
    }
  };

  // -------------------------------------------------------------- render --

  const isMineSide = side === 'by-me';
  const isDraftSide = side === 'drafts';

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* ------------------------------------------------------------ list */}
      <aside className="flex w-96 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800">
        <div className="flex border-b border-slate-200 dark:border-slate-800">
          {(
            [
              { key: 'to-me', label: 'To me' },
              { key: 'by-me', label: 'Issued by me' },
              { key: 'drafts', label: 'Drafts' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => switchSide(tab.key)}
              className={cn(
                'flex-1 border-b-2 px-2 py-2.5 text-sm font-medium transition',
                side === tab.key
                  ? 'border-brand-600 text-brand-700 dark:text-brand-300'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Nothing to search or filter on a list of unfinished things. */}
        {!isDraftSide && (
          <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by reference, title or words…"
                className="input-base w-full pl-8"
              />
            </div>
            <div className="flex items-center gap-4">
              {!isMineSide && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={pendingOnly}
                    onChange={(e) => setPendingOnly(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
                  />
                  Awaiting my acknowledgement
                </label>
              )}
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => setArchived(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
                />
                Archived
              </label>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isDraftSide && (
            <DraftList
              drafts={drafts.map((d) => ({
                id: d.id,
                title: d.title,
                subline: d.requiresAck
                  ? 'Asks for acknowledgement'
                  : 'For information',
                updatedAt: d.updatedAt,
              }))}
              loading={loading}
              emptyMessage="Nothing half-written. Save a circular while composing and it lands here."
              onOpen={(id) =>
                router.push(`/workplace/circulars/send?draft=${id}`)
              }
              onDelete={(id) => void deleteDraft(id)}
            />
          )}

          {!isDraftSide && !loading && items.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-400">
              {search
                ? 'No circular matches that.'
                : archived
                  ? 'Nothing in the archive.'
                  : isMineSide
                    ? 'You have not issued a circular yet.'
                    : pendingOnly
                      ? 'Nothing is waiting on you.'
                      : 'No circulars have been issued to you.'}
            </p>
          )}

          {!isDraftSide &&
            items.map((c) => (
              <button
                key={c.id}
                onClick={() => void open(c)}
                className={cn(
                  'flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition dark:border-slate-800/60',
                  c.id === openId
                    ? 'bg-brand-50 dark:bg-brand-950/40'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                )}
              >
                <Avatar name={c.issuerName} id={c.issuerId} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-mono text-[11px] text-slate-400">
                      {c.reference}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-400">
                      {listTime(c.issuedAt)}
                    </span>
                  </div>
                  <div
                    className={cn(
                      'truncate text-sm',
                      !c.isRead
                        ? 'font-bold text-slate-800 dark:text-slate-100'
                        : 'font-medium text-slate-700 dark:text-slate-200',
                    )}
                  >
                    {c.title}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs text-slate-400">
                      {isMineSide
                        ? c.audience.join(', ') || 'No audience'
                        : c.issuerName}
                    </span>
                    {c.attachmentCount > 0 && (
                      <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {isMineSide ? (
                      c.requiresAck ? (
                        <>
                          <Tag
                            tone={
                              c.ackCount === c.recipientCount
                                ? 'good'
                                : c.isOverdue
                                  ? 'bad'
                                  : 'neutral'
                            }
                          >
                            <BadgeCheck className="h-3 w-3" />
                            {c.ackCount} of {c.recipientCount} acknowledged
                          </Tag>
                          {c.isOverdue && (
                            <Tag tone="bad">
                              <Clock className="h-3 w-3" />
                              Past due
                            </Tag>
                          )}
                        </>
                      ) : (
                        <Tag tone="neutral">
                          <BookOpen className="h-3 w-3" />
                          Read by {c.readCount} of {c.recipientCount}
                        </Tag>
                      )
                    ) : c.acknowledgedAt ? (
                      <Tag tone="good">
                        <CheckCircle2 className="h-3 w-3" />
                        Acknowledged
                      </Tag>
                    ) : c.requiresAck ? (
                      <Tag tone={c.isOverdue ? 'bad' : 'warn'}>
                        <Clock className="h-3 w-3" />
                        {c.ackDueAt
                          ? `Acknowledge by ${listTime(c.ackDueAt)}`
                          : 'Acknowledgement due'}
                      </Tag>
                    ) : (
                      <Tag tone="neutral">For information</Tag>
                    )}
                    {c.archivedAt && <Tag tone="neutral">Archived</Tag>}
                  </div>
                </div>
              </button>
            ))}

          {hasMore && (
            <button
              className="w-full py-3 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              disabled={loading}
              onClick={() => void load({ page: page + 1, append: true })}
            >
              {loading ? 'Loading…' : 'Load older circulars'}
            </button>
          )}
        </div>
      </aside>

      {/* --------------------------------------------------- reading pane */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!circular && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
            <BookOpen className="h-10 w-10" />
            <p className="text-sm">Pick a circular to read it.</p>
          </div>
        )}

        {circular && (
          <>
            <header className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">
                      {circular.reference}
                    </span>
                    {circular.archivedAt && (
                      <Tag tone="neutral">
                        <Archive className="h-3 w-3" />
                        Archived {listTime(circular.archivedAt)}
                      </Tag>
                    )}
                  </div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {circular.title}
                  </h2>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {circular.isMine && (
                    <button
                      className="btn-secondary px-2.5 py-1.5 text-xs"
                      onClick={() =>
                        void setArchivedState(circular.archivedAt === null)
                      }
                      title={
                        circular.archivedAt
                          ? 'Put it back on the live list'
                          : 'Withdraw it to the archive'
                      }
                    >
                      {circular.archivedAt ? (
                        <>
                          <ArchiveRestore className="mr-1 inline h-3.5 w-3.5" />
                          Restore
                        </>
                      ) : (
                        <>
                          <Archive className="mr-1 inline h-3.5 w-3.5" />
                          Archive
                        </>
                      )}
                    </button>
                  )}
                  {/* Put it down. It changes nothing — the notice stays exactly
                      as it is, the pane just empties. */}
                  <button
                    className="rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    onClick={closeOpen}
                    title="Close"
                    aria-label="Close this circular"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Avatar name={circular.issuer.name} id={circular.issuer.id} />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium text-slate-800 dark:text-slate-100">
                    {circular.issuer.name}
                    {circular.isMine && (
                      <span className="ml-1.5 text-xs font-normal text-slate-400">
                        (you)
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <Users className="h-3.5 w-3.5 text-slate-400" />
                    {circular.audience.length === 0 && <span>—</span>}
                    {circular.audience.map((a, i) => (
                      <span
                        key={`${a.kind}-${a.refId ?? 'all'}-${i}`}
                        className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800"
                      >
                        {a.kind === 'EVERYONE' && (
                          <Globe2 className="mr-1 inline h-3 w-3" />
                        )}
                        {a.label}
                      </span>
                    ))}
                    <span className="text-slate-400">
                      · {circular.recipientCount}{' '}
                      {circular.recipientCount === 1 ? 'person' : 'people'}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 text-xs text-slate-400">
                  {fullTime(circular.issuedAt)}
                </span>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {circular.body ? (
                <RichText
                  html={circular.body}
                  className="text-sm text-slate-700 dark:text-slate-200"
                />
              ) : (
                <p className="text-sm italic text-slate-400">No text.</p>
              )}

              {circular.attachments.length > 0 && (
                <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {circular.attachments.length} attachment
                    {circular.attachments.length > 1 ? 's' : ''}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {circular.attachments.map((a) => (
                      <a
                        key={a.id}
                        href={fileUrl(a.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="max-w-[240px] truncate">
                          {a.fileName}
                        </span>
                        <span className="text-xs text-slate-400">
                          {humanSize(a.size)}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* ---- what I owe on it ---- */}
              {circular.me && circular.requiresAck && (
                <div className="mt-6">
                  {circular.me.acknowledgedAt ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950/40">
                      <div className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" />
                        You acknowledged this on{' '}
                        {fullTime(circular.me.acknowledgedAt)}
                      </div>
                      {circular.me.ackNote && (
                        <p className="mt-1 pl-6 text-sm text-emerald-900/80 dark:text-emerald-200/80">
                          “{circular.me.ackNote}”
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-900 dark:bg-brand-950/40">
                      <h3 className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        Please confirm you have read this
                        {circular.ackDueAt && (
                          <span className="ml-1 font-normal text-slate-500 dark:text-slate-400">
                            — by {fullTime(circular.ackDueAt)}
                          </span>
                        )}
                      </h3>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Anything you want on record with it (optional)"
                        maxLength={1000}
                        className="input-base mt-2 min-h-[64px] w-full resize-y text-sm"
                      />
                      <button
                        className="btn-primary mt-2"
                        disabled={acking}
                        onClick={() => void acknowledge()}
                      >
                        <BadgeCheck className="mr-1.5 inline h-4 w-4" />
                        {acking ? 'Recording…' : 'Acknowledge'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ---- the register: the issuer's view ---- */}
              {circular.isMine && (
                <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {circular.requiresAck
                      ? `Acknowledged by ${circular.ackCount} of ${circular.recipientCount}`
                      : `Read by ${circular.readCount} of ${circular.recipientCount}`}
                  </h3>
                  <div className="space-y-1.5">
                    {circular.register.map((r) => {
                      const done = circular.requiresAck
                        ? r.acknowledgedAt
                        : r.readAt;
                      return (
                        <div
                          key={r.id}
                          className="flex items-start gap-2 text-sm"
                        >
                          {done ? (
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          ) : (
                            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />
                          )}
                          <span className="text-slate-700 dark:text-slate-200">
                            {r.name}
                          </span>
                          <span className="text-xs text-slate-400">
                            {done
                              ? fullTime(done)
                              : r.readAt
                                ? `Read ${fullTime(r.readAt)}, not acknowledged`
                                : 'Not read yet'}
                          </span>
                          {r.ackNote && (
                            <span className="text-xs italic text-slate-400">
                              “{r.ackNote}”
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** A small status word beside a row. */
function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}) {
  const tones = {
    good: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
    warn: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
    bad: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
    neutral:
      'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
