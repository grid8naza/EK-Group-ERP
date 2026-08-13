'use client';

import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { humanSize, PeopleField } from '@/components/workplace/people';
import type { Mail, MailAttachmentRef } from '@/lib/types';

/** What the composer opens with — a blank sheet, or a reply to something. */
export interface MailDraft {
  to: { id: number; name: string }[];
  cc: { id: number; name: string }[];
  subject: string;
  body: string;
  replyToId?: number;
}

/** A blank mail. */
export const emptyDraft = (): MailDraft => ({
  to: [],
  cc: [],
  subject: '',
  body: '',
});

/**
 * The draft that answers a mail.
 *
 * `all` decides who hears the answer: Reply goes back to the sender alone,
 * Reply all keeps everyone who was on it — minus yourself, because a copy of
 * your own reply in your own inbox is noise, not a record (Sent already has it).
 */
export function replyDraft(
  mail: Mail,
  myId: number,
  all: boolean,
): MailDraft {
  const others = all
    ? [...mail.to, ...mail.cc]
        .filter((p) => p.id !== myId && p.id !== mail.sender.id)
        .map((p) => ({ id: p.id, name: p.name }))
    : [];
  return {
    to: [{ id: mail.sender.id, name: mail.sender.name }, ...others],
    cc: [],
    subject: mail.subject.replace(/^(re:\s*)+/i, ''),
    // Quoted underneath, the way every mail client does it: the answer reads
    // on its own, and the question it answers is still there to check against.
    body: `\n\n----------\n${mail.sender.name} wrote:\n${mail.body
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}`,
    replyToId: mail.id,
  };
}

/**
 * Write and send one mail — the New Mail screen's whole body, and the same
 * component again inside the reply drawer.
 *
 * Recipients are picked from the directory rather than typed: an internal mail
 * has no address to get wrong, and the backend rejects anyone who is not a
 * colleague anyway, so offering a free-text box would only invite the error.
 */
export function MailComposer({
  initial,
  onSent,
  onCancel,
  autoFocus = 'to',
}: {
  initial?: MailDraft;
  onSent: (mail: Mail) => void;
  onCancel?: () => void;
  /** Which field starts focused — the body, when the recipients are settled. */
  autoFocus?: 'to' | 'body';
}) {
  const toast = useToast();

  const [draft, setDraft] = useState<MailDraft>(initial ?? emptyDraft());
  const [showCc, setShowCc] = useState((initial?.cc.length ?? 0) > 0);
  const [attachments, setAttachments] = useState<MailAttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus === 'body' && bodyRef.current) {
      bodyRef.current.focus();
      // A reply opens with the quote below the cursor, not selected: the point
      // is to type above it.
      bodyRef.current.setSelectionRange(0, 0);
    }
  }, [autoFocus]);

  const patch = (change: Partial<MailDraft>) =>
    setDraft((d) => ({ ...d, ...change }));

  const uploadFiles = async (files: FileList) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        const saved = await api.post<MailAttachmentRef>(
          '/mail/attachments',
          form,
        );
        setAttachments((list) => [...list, saved]);
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
    if (sending) return;
    if (draft.to.length === 0) {
      toast.error('Address it to someone first.');
      return;
    }
    if (!draft.subject.trim()) {
      toast.error('Give the mail a subject.');
      return;
    }
    setSending(true);
    try {
      const mail = await api.post<Mail>('/mail', {
        subject: draft.subject.trim(),
        body: draft.body,
        to: draft.to.map((p) => p.id),
        cc: draft.cc.map((p) => p.id),
        replyToId: draft.replyToId,
        attachments,
      });
      toast.success('Mail sent.');
      setDraft(emptyDraft());
      setAttachments([]);
      setShowCc(false);
      onSent(mail);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The mail was not sent.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PeopleField
        label="To"
        endpoint="/mail/directory"
        chosen={draft.to}
        exclude={draft.cc.map((p) => p.id)}
        onChange={(to) => patch({ to })}
        autoFocus={autoFocus === 'to'}
        action={
          !showCc ? (
            <button
              type="button"
              className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              onClick={() => setShowCc(true)}
            >
              Add Cc
            </button>
          ) : undefined
        }
      />

      {showCc && (
        <PeopleField
          label="Cc"
          endpoint="/mail/directory"
          chosen={draft.cc}
          exclude={draft.to.map((p) => p.id)}
          onChange={(cc) => patch({ cc })}
        />
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
          Subject
        </label>
        <input
          value={draft.subject}
          onChange={(e) => patch({ subject: e.target.value })}
          placeholder="What is it about?"
          maxLength={200}
          className="input-base w-full"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
          Message
        </label>
        <textarea
          ref={bodyRef}
          value={draft.body}
          onChange={(e) => patch({ body: e.target.value })}
          placeholder="Write your message…"
          className="input-base min-h-[220px] w-full flex-1 resize-y font-normal"
        />
      </div>

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <span
              key={`${a.url}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              <Paperclip className="h-3.5 w-3.5 text-slate-400" />
              <span className="max-w-[220px] truncate">{a.fileName}</span>
              <span className="text-slate-400">{humanSize(a.size)}</span>
              <button
                type="button"
                onClick={() =>
                  setAttachments((list) => list.filter((_, x) => x !== i))
                }
                className="text-slate-400 hover:text-rose-500"
                title="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="mr-1.5 inline h-4 w-4" />
            {uploading ? 'Attaching…' : 'Attach'}
          </button>
          <span className="text-xs text-slate-400">Up to 25 MB per file</span>
        </div>
        <div className="flex items-center gap-2">
          {onCancel && (
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={sending || uploading}
            onClick={() => void send()}
          >
            <Send className="mr-1.5 inline h-4 w-4" />
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
