'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  CornerUpLeft,
  Inbox as InboxIcon,
  Mail as MailIcon,
  MailOpen,
  Paperclip,
  ReplyAll,
  Search,
  Send as SendIcon,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { Drawer } from '@/components/ui/Drawer';
import {
  Avatar,
  fileUrl,
  fullTime,
  humanSize,
  listTime,
} from '@/components/workplace/people';
import {
  MailComposer,
  replyDraft,
  type MailDraft,
} from '@/components/workplace/MailComposer';
import { cn } from '@/lib/utils';
import type { Mail, MailListItem, MailPage } from '@/lib/types';

/**
 * A mailbox — the list on the left, the mail you picked on the right.
 *
 * One component serves Inbox and Sent because they are the same screen read
 * from opposite ends: the same rows, the same reading pane, differing only in
 * whose name leads a row and in what you may do with it (you can take a mail
 * out of your own inbox; you cannot reach into anybody else's).
 */
export function MailboxScreen({ box }: { box: 'inbox' | 'sent' }) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const myId = user?.id ?? 0;
  const isInbox = box === 'inbox';

  const [items, setItems] = useState<MailListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const [openId, setOpenId] = useState<number | null>(null);
  const [mail, setMail] = useState<Mail | null>(null);
  const [reply, setReply] = useState<MailDraft | null>(null);

  /**
   * The toast helpers, reachable from `load` without being a dependency of it.
   *
   * ToastProvider builds its context value fresh on each of its renders, so
   * `toast` gets a new identity every time a toast appears. Depending on it
   * would make a failed load raise a toast, re-create `load`, re-fire the effect
   * below and load again — a request loop, out of an error message.
   */
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // ------------------------------------------------------------- loading --

  const load = useCallback(
    async (opts: { page: number; append: boolean }) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (search.trim()) qs.set('q', search.trim());
        if (opts.page > 1) qs.set('page', String(opts.page));
        if (isInbox && unreadOnly) qs.set('unread', '1');
        const data = await api.get<MailPage>(
          `/mail/${box}${qs.toString() ? `?${qs}` : ''}`,
        );
        setItems((list) =>
          opts.append ? [...list, ...data.items] : data.items,
        );
        setHasMore(data.hasMore);
        setPage(opts.page);
      } catch (e) {
        toastRef.current.error(
          e instanceof Error ? e.message : 'The mailbox could not be loaded.',
        );
      } finally {
        setLoading(false);
      }
    },
    [box, isInbox, search, unreadOnly],
  );

  // Typing in the search box waits for a pause rather than querying per letter.
  useEffect(() => {
    const t = setTimeout(() => void load({ page: 1, append: false }), 250);
    return () => clearTimeout(t);
  }, [load]);

  // ---------------------------------------------------------------- open --

  const open = async (row: MailListItem) => {
    setOpenId(row.id);
    try {
      const full = await api.get<Mail>(`/mail/${row.id}`);
      setMail(full);
      // Opening it marks it read on the server; mirror that in the row rather
      // than re-fetching the whole list for one boolean.
      if (isInbox && !row.isRead) {
        setItems((list) =>
          list.map((m) => (m.id === row.id ? { ...m, isRead: true } : m)),
        );
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'That mail could not be opened.',
      );
      setOpenId(null);
    }
  };

  /** Put the open mail down — nothing changes, the pane just empties. */
  const close = () => {
    setMail(null);
    setOpenId(null);
    setReply(null);
  };

  const markUnread = async () => {
    if (!mail) return;
    try {
      await api.post(`/mail/${mail.id}/unread`);
      setItems((list) =>
        list.map((m) => (m.id === mail.id ? { ...m, isRead: false } : m)),
      );
      setMail({ ...mail, isRead: false });
      toast.success('Kept as unread.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work.');
    }
  };

  const remove = async () => {
    if (!mail) return;
    const ok = await confirm({
      title: 'Remove this mail?',
      message:
        'It goes out of your inbox only. The sender keeps their copy, and so does everybody else it was sent to.',
      confirmText: 'Remove',
      cancelText: 'Keep',
    });
    if (!ok) return;
    try {
      await api.delete(`/mail/${mail.id}`);
      setItems((list) => list.filter((m) => m.id !== mail.id));
      setMail(null);
      setOpenId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work.');
    }
  };

  // -------------------------------------------------------------- render --

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* ------------------------------------------------------------ list */}
      <aside className="flex w-96 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800">
        <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isInbox ? 'Search inbox…' : 'Search sent mail…'}
              className="input-base w-full pl-8"
            />
          </div>
          {isInbox && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
              />
              Unread only
            </label>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!loading && items.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-400">
              {search
                ? 'No mail matches that.'
                : isInbox
                  ? 'Nothing in your inbox.'
                  : 'You have not sent any mail yet.'}
            </p>
          )}

          {items.map((m) => {
            // The inbox is read by who wrote it; Sent, by who it went to.
            const lead = isInbox
              ? { id: m.senderId, name: m.senderName }
              : (m.to[0] ?? m.cc[0] ?? { id: 0, name: 'Nobody' });
            const extra = isInbox ? 0 : m.recipientCount - 1;
            return (
              <button
                key={m.id}
                onClick={() => void open(m)}
                className={cn(
                  'flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition dark:border-slate-800/60',
                  m.id === openId
                    ? 'bg-brand-50 dark:bg-brand-950/40'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                )}
              >
                <Avatar name={lead.name} id={lead.id} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        'truncate text-sm text-slate-800 dark:text-slate-100',
                        isInbox && !m.isRead ? 'font-bold' : 'font-medium',
                      )}
                    >
                      {lead.name}
                      {extra > 0 && (
                        <span className="ml-1 text-xs font-normal text-slate-400">
                          +{extra}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-400">
                      {listTime(m.sentAt)}
                    </span>
                  </div>
                  <div
                    className={cn(
                      'truncate text-sm',
                      isInbox && !m.isRead
                        ? 'font-semibold text-slate-800 dark:text-slate-100'
                        : 'text-slate-600 dark:text-slate-300',
                    )}
                  >
                    {m.subject}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs text-slate-400">
                      {m.preview || 'No message'}
                    </span>
                    {m.attachmentCount > 0 && (
                      <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />
                    )}
                  </div>
                  {!isInbox && (
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                      {m.readCount === m.recipientCount ? (
                        <CheckCheck className="h-3 w-3 text-brand-500" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                      Read by {m.readCount} of {m.recipientCount}
                    </div>
                  )}
                </div>
                {isInbox && !m.isRead && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                )}
              </button>
            );
          })}

          {hasMore && (
            <button
              className="w-full py-3 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              disabled={loading}
              onClick={() => void load({ page: page + 1, append: true })}
            >
              {loading ? 'Loading…' : 'Load older mail'}
            </button>
          )}
        </div>
      </aside>

      {/* --------------------------------------------------- reading pane */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!mail && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
            {isInbox ? (
              <InboxIcon className="h-10 w-10" />
            ) : (
              <SendIcon className="h-10 w-10" />
            )}
            <p className="text-sm">Pick a mail to read it.</p>
          </div>
        )}

        {mail && (
          <>
            <header className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div className="mb-3 flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {mail.subject}
                </h2>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    className="btn-secondary px-2.5 py-1.5 text-xs"
                    onClick={() => setReply(replyDraft(mail, myId, false))}
                    title="Reply to the sender"
                  >
                    <CornerUpLeft className="mr-1 inline h-3.5 w-3.5" />
                    Reply
                  </button>
                  {mail.to.length + mail.cc.length > 1 && (
                    <button
                      className="btn-secondary px-2.5 py-1.5 text-xs"
                      onClick={() => setReply(replyDraft(mail, myId, true))}
                      title="Reply to everyone on it"
                    >
                      <ReplyAll className="mr-1 inline h-3.5 w-3.5" />
                      Reply all
                    </button>
                  )}
                  {isInbox && (
                    <>
                      <button
                        className="btn-secondary px-2.5 py-1.5 text-xs"
                        onClick={() => void markUnread()}
                        title="Put it back as unread"
                      >
                        <MailIcon className="mr-1 inline h-3.5 w-3.5" />
                        Unread
                      </button>
                      <button
                        className="btn-secondary px-2.5 py-1.5 text-xs text-rose-600 dark:text-rose-400"
                        onClick={() => void remove()}
                        title="Remove from my inbox"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  {/* Put it down. Last in the row and set apart, because it is
                      the one action here that changes nothing — it closes the
                      mail rather than doing something to it. */}
                  <button
                    className="ml-1 rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    onClick={close}
                    title="Close"
                    aria-label="Close this mail"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Avatar name={mail.sender.name} id={mail.sender.id} />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium text-slate-800 dark:text-slate-100">
                    {mail.sender.name}
                    {mail.isMine && (
                      <span className="ml-1.5 text-xs font-normal text-slate-400">
                        (you)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    <span className="text-slate-400">To:</span>{' '}
                    {mail.to.map((p) => p.name).join(', ') || '—'}
                    {mail.cc.length > 0 && (
                      <>
                        {' · '}
                        <span className="text-slate-400">Cc:</span>{' '}
                        {mail.cc.map((p) => p.name).join(', ')}
                      </>
                    )}
                  </div>
                  {mail.replyTo && (
                    <div className="mt-1 text-xs text-slate-400">
                      In reply to “{mail.replyTo.subject}” from{' '}
                      {mail.replyTo.senderName}
                    </div>
                  )}
                </div>
                <span className="shrink-0 text-xs text-slate-400">
                  {fullTime(mail.sentAt)}
                </span>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                {mail.body || (
                  <span className="italic text-slate-400">No message.</span>
                )}
              </p>

              {mail.attachments.length > 0 && (
                <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {mail.attachments.length} attachment
                    {mail.attachments.length > 1 ? 's' : ''}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {mail.attachments.map((a) => (
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

              {/* Read receipts are the sender's view: who has opened it, and
                  who has not. A recipient sees only their own mark. */}
              {mail.isMine && (
                <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Read by {mail.readCount} of {mail.recipientCount}
                  </h3>
                  <div className="space-y-1.5">
                    {[...mail.to, ...mail.cc].map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        {p.readAt ? (
                          <MailOpen className="h-3.5 w-3.5 text-brand-500" />
                        ) : (
                          <MailIcon className="h-3.5 w-3.5 text-slate-300" />
                        )}
                        <span className="text-slate-700 dark:text-slate-200">
                          {p.name}
                        </span>
                        <span className="text-xs text-slate-400">
                          {p.readAt ? fullTime(p.readAt) : 'Not read yet'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ----------------------------------------------------------- reply */}
      <Drawer
        open={reply !== null}
        onClose={() => setReply(null)}
        title="Reply"
        subtitle={mail ? mail.subject : undefined}
        width="lg"
        icon={<CornerUpLeft className="h-5 w-5" />}
      >
        {reply && (
          <MailComposer
            initial={reply}
            autoFocus="body"
            onCancel={() => setReply(null)}
            onSent={() => {
              setReply(null);
              // A reply belongs in Sent, so only that list is stale.
              if (!isInbox) void load({ page: 1, append: false });
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
