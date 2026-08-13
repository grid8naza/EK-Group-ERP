'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  CornerUpLeft,
  Download,
  FileText,
  MessageCircle,
  Paperclip,
  Pencil,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useChatStream } from '@/lib/useChatStream';
import { useAuth } from '@/providers/AuthProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { Drawer } from '@/components/ui/Drawer';
import {
  Avatar,
  clockOf,
  dayLabel,
  fileUrl,
  humanSize,
  listTime,
} from '@/components/workplace/people';
import { cn } from '@/lib/utils';
import type {
  ChatAttachment,
  ChatAttachmentRef,
  ChatDirectoryUser,
  ChatMessage,
  ChatMessagePage,
  Conversation,
} from '@/lib/types';

/** How long a "…is typing" stays up without another keystroke arriving. */
const TYPING_TTL_MS = 4000;
/** Don't tell the server about every keystroke — one ping per this window. */
const TYPING_PING_MS = 2500;

// Avatar, the date formatters and the file helpers are shared with mail —
// see components/workplace/people.tsx.

// ------------------------------------------------------------- attachments --

function AttachmentView({ file }: { file: ChatAttachment }) {
  const href = fileUrl(file.url);
  if (file.mimeType.startsWith('image/')) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={href}
          alt={file.fileName}
          className="max-h-64 max-w-full rounded-lg object-cover"
        />
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{file.fileName}</span>
      <span className="shrink-0 text-xs opacity-70">
        {humanSize(file.size)}
      </span>
      <Download className="h-3.5 w-3.5 shrink-0 opacity-70" />
    </a>
  );
}

// ================================================================== screen ==

/**
 * Internal chat (SRS §8.11, FR-COM-02) — one-to-one and group conversations in
 * the shape people already know from a phone messenger: a list on the left,
 * the thread on the right, newest at the bottom.
 *
 * Messages arrive over a live stream rather than by polling, so a reply lands
 * while you are looking at it. Everything the stream carries is also derivable
 * from the API, which is what makes a dropped connection survivable: on
 * reconnect the screen refetches and carries on.
 */
export function ChatScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const myId = user?.id ?? 0;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [pending, setPending] = useState<ChatAttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [typers, setTypers] = useState<
    Record<number, { name: string; at: number }>
  >({});
  const [picker, setPicker] = useState<'none' | 'direct' | 'group'>('none');

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTypingPing = useRef(0);
  // Read by the stream handler, which is created once and would otherwise close
  // over the first render's null.
  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeId;

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  /**
   * The toast helpers, reachable from the loaders without being a dependency of
   * them. ToastProvider builds its context value fresh on each of its renders,
   * so `toast` gets a new identity every time a toast appears — and a loader
   * that depended on it would raise an error toast, be re-created, re-fire the
   * effect that calls it and fail again, turning one failure into a loop.
   */
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // ------------------------------------------------------------ data loads --

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api.get<Conversation[]>('/chat/conversations'));
    } catch {
      toastRef.current.error('Could not load your conversations.');
    }
  }, []);

  const loadThread = useCallback(async (conversationId: number) => {
    setLoadingThread(true);
    try {
      const page = await api.get<ChatMessagePage>(
        `/chat/conversations/${conversationId}/messages`,
      );
      setMessages(page.messages);
      setHasMore(page.hasMore);
    } catch {
      toastRef.current.error('Could not open that conversation.');
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (activeId == null) {
      setMessages([]);
      return;
    }
    setReplyTo(null);
    setEditing(null);
    void loadThread(activeId);
  }, [activeId, loadThread]);

  // ------------------------------------------------------------ read marks --

  /** Tell the server how far this reader has got, and clear the local badge. */
  const markRead = useCallback(
    async (conversationId: number, lastMessageId: number) => {
      if (!lastMessageId) return;
      setConversations((list) =>
        list.map((c) =>
          c.id === conversationId
            ? { ...c, unreadCount: 0, myLastReadMessageId: lastMessageId }
            : c,
        ),
      );
      try {
        await api.post(`/chat/conversations/${conversationId}/read`, {
          lastMessageId,
        });
      } catch {
        // A missed receipt corrects itself on the next one — not worth a toast.
      }
    },
    [],
  );

  // Reading is "the newest message is on screen", which is true whenever the
  // thread is open and scrolled to the bottom — the same moment a person would
  // say they had read it.
  useEffect(() => {
    if (activeId == null || messages.length === 0) return;
    const newest = messages[messages.length - 1];
    if (newest.senderId === myId) return;
    if ((active?.myLastReadMessageId ?? 0) >= newest.id) return;
    void markRead(activeId, newest.id);
  }, [activeId, messages, myId, active?.myLastReadMessageId, markRead]);

  // Newest message at the bottom, like every messenger. Jumps rather than
  // animates: a smooth scroll on every arrival makes a busy thread seasick.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId, messages.length]);

  // --------------------------------------------------------------- streaming --

  const onStreamEvent = useCallback(
    (event: { type: string; data: unknown }) => {
      const payload = event.data as Record<string, unknown>;
      const conversationId = Number(payload?.conversationId);

      switch (event.type) {
        case 'message.new': {
          const message = payload.message as ChatMessage;
          if (conversationId === activeIdRef.current) {
            // Guard against a double-append: the sender already has this
            // message from the POST response.
            setMessages((list) =>
              list.some((m) => m.id === message.id) ? list : [...list, message],
            );
          }
          setConversations((list) =>
            list.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    lastMessageAt: message.createdAt,
                    lastMessageText: message.body ?? '📎 Attachment',
                    lastMessageById: message.senderId,
                    unreadCount:
                      message.senderId === myId ||
                      conversationId === activeIdRef.current
                        ? c.unreadCount
                        : c.unreadCount + 1,
                  }
                : c,
            ),
          );
          // A message in a thread this client has never seen (a brand-new one)
          // is not in the list yet.
          setConversations((list) => {
            if (list.some((c) => c.id === conversationId)) return list;
            void loadConversations();
            return list;
          });
          break;
        }
        case 'message.updated': {
          const message = payload.message as ChatMessage;
          setMessages((list) =>
            list.map((m) => (m.id === message.id ? message : m)),
          );
          break;
        }
        case 'message.deleted': {
          const messageId = Number(payload.messageId);
          setMessages((list) =>
            list.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    deletedAt: new Date().toISOString(),
                    body: null,
                    attachments: [],
                  }
                : m,
            ),
          );
          break;
        }
        case 'conversation.read': {
          const upTo = Number(payload.lastReadMessageId);
          const who = Number(payload.userId);
          if (who === myId) break;
          setConversations((list) =>
            list.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    participants: c.participants.map((p) =>
                      p.id === who ? { ...p, lastReadMessageId: upTo } : p,
                    ),
                    readByOthersUpTo: Math.min(
                      ...c.participants
                        .filter((p) => p.id !== myId && !p.hasLeft)
                        .map((p) =>
                          p.id === who ? upTo : (p.lastReadMessageId ?? 0),
                        ),
                    ),
                  }
                : c,
            ),
          );
          break;
        }
        case 'typing': {
          const who = Number(payload.userId);
          if (conversationId !== activeIdRef.current || who === myId) break;
          setTypers((t) => ({
            ...t,
            [who]: { name: String(payload.userName ?? ''), at: Date.now() },
          }));
          break;
        }
        case 'conversation.new':
        case 'conversation.updated':
          void loadConversations();
          break;
      }
    },
    [myId, loadConversations],
  );

  // On reconnect everything that happened while the socket was down was missed,
  // so the screen re-reads rather than guessing.
  const onReconnect = useCallback(() => {
    void loadConversations();
    if (activeIdRef.current != null) void loadThread(activeIdRef.current);
  }, [loadConversations, loadThread]);

  useChatStream(onStreamEvent, onReconnect);

  // "…is typing" expires on its own; the sender never says they stopped.
  useEffect(() => {
    const timer = setInterval(() => {
      setTypers((t) => {
        const now = Date.now();
        const live = Object.entries(t).filter(
          ([, v]) => now - v.at < TYPING_TTL_MS,
        );
        return live.length === Object.keys(t).length
          ? t
          : Object.fromEntries(live);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // ---------------------------------------------------------------- actions --

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (activeId == null) return;
    const now = Date.now();
    if (now - lastTypingPing.current < TYPING_PING_MS) return;
    lastTypingPing.current = now;
    void api.post(`/chat/conversations/${activeId}/typing`).catch(() => {});
  };

  const uploadFiles = async (files: FileList) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        const saved = await api.post<ChatAttachmentRef>(
          '/chat/attachments',
          form,
        );
        setPending((list) => [...list, saved]);
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'That file could not be uploaded.',
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const send = async () => {
    if (activeId == null || sending) return;
    const body = draft.trim();

    if (editing) {
      if (!body) return;
      setSending(true);
      try {
        const updated = await api.patch<ChatMessage>(
          `/chat/messages/${editing.id}`,
          { body },
        );
        setMessages((list) =>
          list.map((m) => (m.id === updated.id ? updated : m)),
        );
        setEditing(null);
        setDraft('');
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : 'Could not save the edit.',
        );
      } finally {
        setSending(false);
      }
      return;
    }

    if (!body && pending.length === 0) return;
    setSending(true);
    try {
      const message = await api.post<ChatMessage>(
        `/chat/conversations/${activeId}/messages`,
        {
          body: body || undefined,
          replyToId: replyTo?.id,
          attachments: pending.length ? pending : undefined,
        },
      );
      setMessages((list) =>
        list.some((m) => m.id === message.id) ? list : [...list, message],
      );
      setConversations((list) =>
        list.map((c) =>
          c.id === activeId
            ? {
                ...c,
                lastMessageAt: message.createdAt,
                lastMessageText: message.body ?? '📎 Attachment',
                lastMessageById: myId,
              }
            : c,
        ),
      );
      setDraft('');
      setPending([]);
      setReplyTo(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Message not sent.');
    } finally {
      setSending(false);
    }
  };

  const removeMessage = async (message: ChatMessage) => {
    const ok = await confirm({
      title: 'Delete this message?',
      message:
        'It will be removed for everyone in the conversation. The thread will show that a message was deleted.',
      confirmText: 'Delete',
      cancelText: 'Keep',
    });
    if (!ok) return;
    try {
      await api.delete(`/chat/messages/${message.id}`);
      setMessages((list) =>
        list.map((m) =>
          m.id === message.id
            ? {
                ...m,
                deletedAt: new Date().toISOString(),
                body: null,
                attachments: [],
              }
            : m,
        ),
      );
    } catch {
      toast.error('Could not delete that message.');
    }
  };

  const loadOlder = async () => {
    if (activeId == null || messages.length === 0) return;
    try {
      const page = await api.get<ChatMessagePage>(
        `/chat/conversations/${activeId}/messages?before=${messages[0].id}`,
      );
      const el = scrollRef.current;
      const before = el?.scrollHeight ?? 0;
      setMessages((list) => [...page.messages, ...list]);
      setHasMore(page.hasMore);
      // Keep the reader where they were rather than at the new top.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
    } catch {
      toast.error('Could not load older messages.');
    }
  };

  const openConversation = (conversation: Conversation) => {
    setActiveId(conversation.id);
    setTypers({});
    setDraft('');
    setPending([]);
  };

  // ----------------------------------------------------------------- render --

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) =>
      [c.title, c.lastMessageText]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [conversations, search]);

  const typingNames = Object.values(typers)
    .map((t) => t.name)
    .filter(Boolean);

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* ---------------------------------------------------- conversations */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800">
        <div className="border-b border-slate-200 p-3 dark:border-slate-800">
          <div className="mb-2 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats…"
                className="input-base w-full pl-8"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-secondary flex-1 px-2 py-1 text-xs"
              onClick={() => setPicker('direct')}
            >
              <MessageCircle className="mr-1 inline h-3.5 w-3.5" />
              New chat
            </button>
            <button
              className="btn-secondary flex-1 px-2 py-1 text-xs"
              onClick={() => setPicker('group')}
            >
              <Users className="mr-1 inline h-3.5 w-3.5" />
              New group
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-400">
              {search ? 'No chat matches that.' : 'No conversations yet.'}
            </p>
          )}
          {visible.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c)}
              className={cn(
                'flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition dark:border-slate-800/60',
                c.id === activeId
                  ? 'bg-brand-50 dark:bg-brand-950/40'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
              )}
            >
              <Avatar
                name={c.title}
                id={c.counterpartId ?? c.id * 1000}
                online={c.kind === 'DIRECT' && c.isOnline}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    {c.kind === 'GROUP' && (
                      <Users className="mr-1 inline h-3 w-3 text-slate-400" />
                    )}
                    {c.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {listTime(c.lastMessageAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {c.lastMessageById === myId && 'You: '}
                    {c.lastMessageText || 'No messages yet'}
                  </span>
                  {c.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* ----------------------------------------------------------- thread */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!active && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
            <MessageCircle className="h-10 w-10" />
            <p className="text-sm">Pick a conversation, or start a new one.</p>
          </div>
        )}

        {active && (
          <>
            <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <Avatar
                name={active.title}
                id={active.counterpartId ?? active.id * 1000}
                online={active.kind === 'DIRECT' && active.isOnline}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-slate-800 dark:text-slate-100">
                  {active.title}
                </div>
                <div className="truncate text-xs text-slate-400">
                  {typingNames.length > 0
                    ? `${typingNames.join(', ')} is typing…`
                    : active.kind === 'GROUP'
                      ? `${active.participants.filter((p) => !p.hasLeft).length} members`
                      : active.isOnline
                        ? 'Online'
                        : 'Offline'}
                </div>
              </div>
            </header>

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-slate-50 px-4 py-3 dark:bg-slate-950/40"
            >
              {hasMore && (
                <div className="flex justify-center pb-2">
                  <button
                    className="btn-secondary px-3 py-1 text-xs"
                    onClick={() => void loadOlder()}
                  >
                    Load earlier messages
                  </button>
                </div>
              )}
              {loadingThread && (
                <p className="py-6 text-center text-sm text-slate-400">
                  Loading…
                </p>
              )}
              {!loadingThread && messages.length === 0 && (
                <p className="py-10 text-center text-sm text-slate-400">
                  No messages yet — say hello.
                </p>
              )}

              {messages.map((m, i) => {
                const mine = m.senderId === myId;
                const prev = messages[i - 1];
                const newDay =
                  !prev ||
                  new Date(prev.createdAt).toDateString() !==
                    new Date(m.createdAt).toDateString();
                // In a group, the sender's name is only worth repeating when it
                // changes — a run from one person reads as one block.
                const showName =
                  active.kind === 'GROUP' &&
                  !mine &&
                  (!prev || prev.senderId !== m.senderId || newDay);

                if (m.kind === 'SYSTEM') {
                  return (
                    <div key={m.id}>
                      {newDay && <DaySeparator iso={m.createdAt} />}
                      <p className="py-1 text-center text-[11px] text-slate-400">
                        {m.body}
                      </p>
                    </div>
                  );
                }

                return (
                  <div key={m.id}>
                    {newDay && <DaySeparator iso={m.createdAt} />}
                    <div
                      className={cn(
                        'group flex gap-2',
                        mine ? 'justify-end' : 'justify-start',
                      )}
                    >
                      {/* Actions sit outside the bubble, on hover — the same
                          place whichever side the message is on. */}
                      {mine && !m.deletedAt && (
                        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                          <IconButton
                            title="Reply"
                            onClick={() => setReplyTo(m)}
                            icon={<CornerUpLeft className="h-3.5 w-3.5" />}
                          />
                          {m.kind === 'TEXT' && (
                            <IconButton
                              title="Edit"
                              onClick={() => {
                                setEditing(m);
                                setDraft(m.body ?? '');
                              }}
                              icon={<Pencil className="h-3.5 w-3.5" />}
                            />
                          )}
                          <IconButton
                            title="Delete"
                            onClick={() => void removeMessage(m)}
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                          />
                        </div>
                      )}

                      <div
                        className={cn(
                          'max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm',
                          mine
                            ? 'rounded-br-sm bg-brand-600 text-white'
                            : 'rounded-bl-sm bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100',
                        )}
                      >
                        {showName && (
                          <div className="mb-0.5 text-xs font-semibold text-brand-600 dark:text-brand-400">
                            {m.senderName}
                          </div>
                        )}

                        {m.replyTo && (
                          <div
                            className={cn(
                              'mb-1 border-l-2 pl-2 text-xs',
                              mine
                                ? 'border-white/50 text-white/80'
                                : 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400',
                            )}
                          >
                            <div className="font-medium">
                              {m.replyTo.senderName}
                            </div>
                            <div className="line-clamp-2">
                              {m.replyTo.deleted
                                ? 'Message deleted'
                                : m.replyTo.body}
                            </div>
                          </div>
                        )}

                        {m.deletedAt ? (
                          <span className="italic opacity-60">
                            This message was deleted
                          </span>
                        ) : (
                          <>
                            {m.attachments.length > 0 && (
                              <div className="mb-1 space-y-1">
                                {m.attachments.map((f) => (
                                  <AttachmentView key={f.id} file={f} />
                                ))}
                              </div>
                            )}
                            {m.body && (
                              <p className="whitespace-pre-wrap break-words">
                                {m.body}
                              </p>
                            )}
                          </>
                        )}

                        <div
                          className={cn(
                            'mt-0.5 flex items-center justify-end gap-1 text-[10px]',
                            mine
                              ? 'text-white/70'
                              : 'text-slate-400 dark:text-slate-500',
                          )}
                        >
                          {m.editedAt && !m.deletedAt && <span>edited</span>}
                          <span>{clockOf(m.createdAt)}</span>
                          {/* One tick sent, two ticks read by everyone else. */}
                          {mine &&
                            !m.deletedAt &&
                            (active.readByOthersUpTo >= m.id ? (
                              <CheckCheck className="h-3.5 w-3.5" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            ))}
                        </div>
                      </div>

                      {!mine && !m.deletedAt && (
                        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                          <IconButton
                            title="Reply"
                            onClick={() => setReplyTo(m)}
                            icon={<CornerUpLeft className="h-3.5 w-3.5" />}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ------------------------------------------------- composer */}
            <div className="border-t border-slate-200 p-3 dark:border-slate-800">
              {(replyTo || editing) && (
                <div className="mb-2 flex items-start gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-600 dark:text-slate-300">
                      {editing
                        ? 'Editing your message'
                        : `Replying to ${replyTo?.senderName}`}
                    </div>
                    <div className="truncate text-slate-500 dark:text-slate-400">
                      {(editing ?? replyTo)?.body}
                    </div>
                  </div>
                  <button
                    className="text-slate-400 hover:text-slate-600"
                    onClick={() => {
                      setReplyTo(null);
                      if (editing) {
                        setEditing(null);
                        setDraft('');
                      }
                    }}
                    title="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {pending.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {pending.map((f, i) => (
                    <span
                      key={`${f.url}-${i}`}
                      className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800"
                    >
                      <Paperclip className="h-3 w-3" />
                      <span className="max-w-40 truncate">{f.fileName}</span>
                      <button
                        onClick={() =>
                          setPending((list) => list.filter((_, j) => j !== i))
                        }
                        className="text-slate-400 hover:text-rose-500"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) =>
                    e.target.files && void uploadFiles(e.target.files)
                  }
                />
                <button
                  className="btn-secondary shrink-0 px-2.5 py-2"
                  title="Attach a file"
                  disabled={uploading || !!editing}
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <textarea
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends, Shift+Enter starts a new line — the habit
                    // every messenger has taught.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder={
                    editing ? 'Edit your message…' : 'Type a message…'
                  }
                  className="input-base max-h-32 min-h-[2.5rem] flex-1 resize-y py-2"
                />
                <button
                  className="btn-primary shrink-0 px-3 py-2"
                  disabled={
                    sending ||
                    uploading ||
                    (!draft.trim() && pending.length === 0)
                  }
                  onClick={() => void send()}
                  title={editing ? 'Save' : 'Send'}
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              {uploading && (
                <p className="mt-1 text-xs text-slate-400">Uploading…</p>
              )}
            </div>
          </>
        )}
      </section>

      <PeoplePicker
        mode={picker}
        onClose={() => setPicker('none')}
        onStarted={(conversation) => {
          setPicker('none');
          setConversations((list) =>
            list.some((c) => c.id === conversation.id)
              ? list.map((c) => (c.id === conversation.id ? conversation : c))
              : [conversation, ...list],
          );
          setActiveId(conversation.id);
        }}
      />
    </div>
  );
}

function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex justify-center">
      <span className="rounded-full bg-slate-200 px-3 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        {dayLabel(iso)}
      </span>
    </div>
  );
}

function IconButton({
  title,
  onClick,
  icon,
}: {
  title: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
    >
      {icon}
    </button>
  );
}

// ------------------------------------------------------------ people picker --

/**
 * Choosing who to talk to. One component for both cases because they differ
 * only in how many people you may pick and whether the group needs a name.
 */
function PeoplePicker({
  mode,
  onClose,
  onStarted,
}: {
  mode: 'none' | 'direct' | 'group';
  onClose: () => void;
  onStarted: (conversation: Conversation) => void;
}) {
  const toast = useToast();
  const [people, setPeople] = useState<ChatDirectoryUser[]>([]);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<number[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  // See the note on toastRef above: depending on `toast` here would re-run this
  // effect on the very toast its own failure raises.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const open = mode !== 'none';

  useEffect(() => {
    if (!open) return;
    setQ('');
    setChosen([]);
    setTitle('');
    api
      .get<ChatDirectoryUser[]>('/chat/directory')
      .then(setPeople)
      .catch(() => toastRef.current.error('Could not load the people list.'));
  }, [open]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((p) =>
      [p.name, p.username, p.userCode]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [people, q]);

  const start = async (userId?: number) => {
    setBusy(true);
    try {
      const conversation =
        mode === 'direct'
          ? await api.post<Conversation>('/chat/conversations/direct', {
              userId,
            })
          : await api.post<Conversation>('/chat/conversations/group', {
              title: title.trim(),
              userIds: chosen,
            });
      onStarted(conversation);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Could not start that conversation.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={mode === 'group' ? 'New group' : 'New chat'}
      subtitle={
        mode === 'group'
          ? 'Name it, then pick who is in it'
          : 'Pick who you want to talk to'
      }
      width="sm"
      icon={
        mode === 'group' ? (
          <Users className="h-5 w-5" />
        ) : (
          <MessageCircle className="h-5 w-5" />
        )
      }
      footer={
        mode === 'group' ? (
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={busy || !title.trim() || chosen.length === 0}
              onClick={() => void start()}
            >
              Create group
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {mode === 'group' && (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Group name (e.g. Kitchen — Main Branch)"
            className="input-base w-full"
          />
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people…"
            className="input-base w-full pl-8"
          />
        </div>

        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {shown.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">
              Nobody matches that.
            </p>
          )}
          {shown.map((p) => {
            const picked = chosen.includes(p.id);
            return (
              <button
                key={p.id}
                disabled={busy}
                onClick={() =>
                  mode === 'direct'
                    ? void start(p.id)
                    : setChosen((list) =>
                        picked
                          ? list.filter((id) => id !== p.id)
                          : [...list, p.id],
                      )
                }
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition',
                  picked
                    ? 'bg-brand-50 dark:bg-brand-950/40'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                )}
              >
                <Avatar name={p.name} id={p.id} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    {p.name}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {p.username}
                  </div>
                </div>
                {mode === 'group' && picked && (
                  <Check className="h-4 w-4 text-brand-600" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </Drawer>
  );
}
