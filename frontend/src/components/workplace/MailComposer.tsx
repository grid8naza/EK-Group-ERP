'use client';

import { useEffect, useRef, useState } from 'react';
import { Paperclip, Save, Send, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useChoice } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { humanSize, PeopleField } from '@/components/workplace/people';
import type { Mail, MailAttachmentRef, SavedMailDraft } from '@/lib/types';

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
export function replyDraft(mail: Mail, myId: number, all: boolean): MailDraft {
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
  draftId,
  onSent,
  onCancel,
  onDraftGone,
  autoFocus = 'to',
}: {
  initial?: MailDraft;
  /** Carry on with a saved draft, loaded on mount. */
  draftId?: number;
  onSent: (mail: Mail) => void;
  onCancel?: () => void;
  /** The saved draft was sent or deleted — the screen showing it is now stale. */
  onDraftGone?: () => void;
  /** Which field starts focused — the body, when the recipients are settled. */
  autoFocus?: 'to' | 'body';
}) {
  const toast = useToast();
  const choose = useChoice();

  const [draft, setDraft] = useState<MailDraft>(initial ?? emptyDraft());
  const [showCc, setShowCc] = useState((initial?.cc.length ?? 0) > 0);
  const [attachments, setAttachments] = useState<MailAttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  /**
   * The saved draft this is, once there is one.
   *
   * Held in state rather than taken from the prop alone, because saving turns
   * an unsaved composer into a saved one: the first Save creates the row, and
   * every Save after it updates that row instead of leaving a trail of them.
   */
  const [savedId, setSavedId] = useState<number | undefined>(draftId);
  const [savingDraft, setSavingDraft] = useState(false);
  /** A loaded draft has just reached the form — re-mark the baseline after it. */
  const [justLoaded, setJustLoaded] = useState(false);
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

  // Load the draft being carried on with.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  useEffect(() => {
    if (!draftId) return;
    let alive = true;
    api
      .get<SavedMailDraft>(`/mail/drafts/${draftId}`)
      .then((d) => {
        if (!alive) return;
        setDraft({
          to: d.to,
          cc: d.cc,
          subject: d.subject,
          body: d.body,
          replyToId: d.replyToId ?? undefined,
        });
        setAttachments(d.attachments);
        setShowCc(d.cc.length > 0);
        // Not baseline.current = snapshot() here: these setStates have not
        // landed yet, so it would mark the EMPTY form and call the loaded draft
        // dirty the moment it appeared. The effect below runs after they do.
        setJustLoaded(true);
      })
      .catch((e) =>
        toastRef.current.error(
          e instanceof Error ? e.message : 'That draft could not be opened.',
        ),
      );
    return () => {
      alive = false;
    };
  }, [draftId]);

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

  /**
   * What the form said when it was last saved, loaded, or opened blank.
   *
   * Cancel asks about UNSAVED work, not about work: a draft opened and closed
   * again untouched, or a blank form, has nothing to lose and must not stop to
   * ask. So the question is "has this changed since it was last kept", which
   * needs a mark to measure against rather than a count of what is on screen.
   */
  const baseline = useRef<string>('');
  const isDirty = () => snapshot() !== baseline.current;

  useEffect(() => {
    // The blank form, or the reply this opened with — either way, the mark.
    if (!draftId) baseline.current = snapshot();
    // Once, at mount: everything after is a change somebody made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!justLoaded) return;
    baseline.current = snapshot();
    setJustLoaded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justLoaded]);

  const cancel = async () => {
    if (!onCancel) return;
    if (!isDirty()) {
      onCancel();
      return;
    }
    const picked = await choose({
      title: 'Leave this mail?',
      message: savedId
        ? 'It has changed since you last saved it.'
        : 'It has not been sent or saved yet.',
      dismissKey: 'keep',
      actions: [
        {
          key: 'keep',
          label: 'Keep writing',
          tone: 'secondary',
          autoFocus: true,
        },
        { key: 'save', label: 'Save draft', tone: 'secondary' },
        { key: 'discard', label: 'Discard changes', tone: 'danger' },
      ],
    });
    if (picked === 'keep') return;
    // A save that failed must not then throw the work away by navigating off.
    if (picked === 'save' && !(await saveDraft())) return;
    onCancel();
  };

  /** The form as a string, for comparing against the last saved state. */
  const snapshot = () => JSON.stringify(contents());

  /** What is on the form right now, in the shape both saving and sending take. */
  const contents = () => ({
    subject: draft.subject.trim(),
    body: draft.body,
    to: draft.to.map((p) => p.id),
    cc: draft.cc.map((p) => p.id),
    replyToId: draft.replyToId,
    attachments,
  });

  /**
   * Keep it without sending it.
   *
   * Nothing is required — that is what a draft is for. The first save creates
   * the row and every one after it updates the same row, so a mail written over
   * three sittings is one draft rather than three.
   */
  const saveDraft = async (): Promise<boolean> => {
    if (savingDraft) return false;
    setSavingDraft(true);
    try {
      const saved = savedId
        ? await api.patch<SavedMailDraft>(`/mail/drafts/${savedId}`, contents())
        : await api.post<SavedMailDraft>('/mail/drafts', contents());
      setSavedId(saved.id);
      // What was just kept is the new mark to measure changes against.
      baseline.current = snapshot();
      toast.success('Draft saved.');
      return true;
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'The draft could not be saved.',
      );
      return false;
    } finally {
      setSavingDraft(false);
    }
  };

  /** Throw the saved draft away. Nothing was sent, so nothing is withdrawn. */
  const deleteDraft = async () => {
    if (!savedId) return;
    try {
      await api.delete(`/mail/drafts/${savedId}`);
      setSavedId(undefined);
      setDraft(emptyDraft());
      setAttachments([]);
      setShowCc(false);
      toast.success('Draft deleted.');
      onDraftGone?.();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'The draft could not be deleted.',
      );
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
    if (!draft.body.trim()) {
      toast.error('Write a message before sending it.');
      return;
    }
    setSending(true);
    try {
      // A saved draft is sent through its own route, which sends and deletes it
      // together — two calls could leave the mail sent and the draft behind.
      const mail = savedId
        ? await api
            .patch<SavedMailDraft>(`/mail/drafts/${savedId}`, contents())
            .then(() => api.post<Mail>(`/mail/drafts/${savedId}/send`))
        : await api.post<Mail>('/mail', contents());
      toast.success('Mail sent.');
      setSavedId(undefined);
      setDraft(emptyDraft());
      setAttachments([]);
      setShowCc(false);
      if (savedId) onDraftGone?.();
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
        // Not on a draft. Focusing the To line opens the directory under it,
        // which is what you want on a blank mail and noise on one whose
        // recipients were settled days ago.
        autoFocus={autoFocus === 'to' && !draftId}
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
          {savedId && (
            <button
              type="button"
              className="btn-secondary text-rose-600 dark:text-rose-400"
              onClick={() => void deleteDraft()}
              title="Throw this draft away"
            >
              <Trash2 className="mr-1.5 inline h-4 w-4" />
              Delete draft
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={savingDraft || uploading}
            onClick={() => void saveDraft()}
            title="Keep it without sending"
          >
            <Save className="mr-1.5 inline h-4 w-4" />
            {savingDraft ? 'Saving…' : savedId ? 'Save draft' : 'Save as draft'}
          </button>
          {onCancel && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void cancel()}
            >
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
