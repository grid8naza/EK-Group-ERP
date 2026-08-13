'use client';

import { useEffect, useRef, useState } from 'react';
import { Megaphone, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useChoice } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { DateInput } from '@/components/ui/Field';
import { RichTextEditor, richTextIsEmpty } from '@/components/ui/RichText';
import { AudienceField } from '@/components/workplace/AudienceField';
import { PRIORITIES } from '@/components/workplace/broadcast-ui';
import { cn } from '@/lib/utils';
import type {
  Audience,
  Broadcast,
  BroadcastPriority,
  SavedBroadcastDraft,
} from '@/lib/types';

/**
 * Send one announcement — the Send Broadcast screen's whole body.
 *
 * Shorter than the circular composer on purpose, and it asks for less: no
 * acknowledgement, no attachment, no reference. What it does ask that the
 * circular does not is how long it should stay up, because an announcement that
 * never goes away is how a feed of them stops being read.
 */
export function BroadcastComposer({
  draftId,
  onSent,
  onCancel,
  onDraftGone,
}: {
  /** Carry on with a saved draft, loaded on mount. */
  draftId?: number;
  onSent: (broadcast: Broadcast) => void;
  /** Leave without sending or saving. */
  onCancel?: () => void;
  /** The saved draft was sent or deleted. */
  onDraftGone?: () => void;
}) {
  const toast = useToast();
  const choose = useChoice();

  const [audience, setAudience] = useState<Audience>({});
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<BroadcastPriority>('NORMAL');
  const [expiresAt, setExpiresAt] = useState('');
  const [sending, setSending] = useState(false);
  /** The saved draft this is, once there is one — see MailComposer.savedId. */
  const [savedId, setSavedId] = useState<number | undefined>(draftId);
  const [savingDraft, setSavingDraft] = useState(false);
  /** A loaded draft has just reached the form — re-mark the baseline after it. */
  const [justLoaded, setJustLoaded] = useState(false);

  const toastRef = useRef(toast);
  toastRef.current = toast;
  useEffect(() => {
    if (!draftId) return;
    let alive = true;
    api
      .get<SavedBroadcastDraft>(`/broadcasts/drafts/${draftId}`)
      .then((d) => {
        if (!alive) return;
        setTitle(d.title);
        setBody(d.body);
        setAudience(d.audience ?? {});
        setPriority(d.priority);
        setExpiresAt(d.expiresAt ? d.expiresAt.slice(0, 10) : '');
        // The baseline is marked by the effect below, once these have landed.
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

  /** The form as a string, for comparing against the last saved state. */
  const snapshot = () => JSON.stringify(contents());

  /** What it said when last saved, loaded, or opened blank — see MailComposer. */
  const baseline = useRef<string>('');
  const isDirty = () => snapshot() !== baseline.current;

  useEffect(() => {
    if (!draftId) baseline.current = snapshot();
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
      title: 'Leave this broadcast?',
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

  /** What is on the form right now, for saving and for sending alike. */
  const contents = () => ({
    title: title.trim(),
    body,
    audience,
    priority,
    expiresAt: expiresAt || undefined,
  });

  /** Keep it without sending it. */
  const saveDraft = async (): Promise<boolean> => {
    if (savingDraft) return false;
    setSavingDraft(true);
    try {
      const saved = savedId
        ? await api.patch<SavedBroadcastDraft>(
            `/broadcasts/drafts/${savedId}`,
            contents(),
          )
        : await api.post<SavedBroadcastDraft>('/broadcasts/drafts', contents());
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
      await api.delete(`/broadcasts/drafts/${savedId}`);
      setSavedId(undefined);
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
    if (!title.trim()) {
      toast.error('Give the broadcast a title.');
      return;
    }
    if (richTextIsEmpty(body)) {
      toast.error('Write the announcement before sending it.');
      return;
    }
    try {
      setSending(true);
      // A saved draft is sent through its own route, which sends and deletes it
      // together — two calls could leave it sent and the draft behind.
      const broadcast = savedId
        ? await api
            .patch<SavedBroadcastDraft>(
              `/broadcasts/drafts/${savedId}`,
              contents(),
            )
            .then(() =>
              api.post<Broadcast>(`/broadcasts/drafts/${savedId}/send`),
            )
        : await api.post<Broadcast>('/broadcasts', contents());
      if (savedId) onDraftGone?.();
      toast.success(
        `Broadcast sent to ${broadcast.recipientCount} ${
          broadcast.recipientCount === 1 ? 'person' : 'people'
        }.`,
      );
      onSent(broadcast);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'The broadcast was not sent.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    // The fields scroll; the action does not — same as the circular composer.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <AudienceField
          label="Announce to"
          value={audience}
          onChange={setAudience}
          optionsEndpoint="/broadcasts/audience"
          previewEndpoint="/broadcasts/audience/preview"
          directoryEndpoint="/broadcasts/directory"
        />

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Announcement
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Say it in one line"
            maxLength={160}
            className="input-base w-full"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Details
          </label>
          <RichTextEditor
            value={body}
            onChange={setBody}
            placeholder="Anything more they need to know…"
            minHeight={140}
          />
          <p className="mt-1 text-xs text-slate-400">
            Shown in full on the card — nobody has to open it to read it.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              How loudly
            </label>
            <div className="flex gap-1.5">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  title={p.hint}
                  onClick={() => setPriority(p.value)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm transition',
                    priority === p.value
                      ? 'border-brand-500 bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/50 dark:text-brand-300'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/60',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="w-44">
            <DateInput
              label="Show until"
              value={expiresAt}
              onChange={setExpiresAt}
            />
          </div>
          <p className="flex-1 text-xs text-slate-400">
            Leave the date empty and it stays up until each person dismisses it.
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
        {onCancel && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void cancel()}
          >
            Cancel
          </button>
        )}
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
          disabled={savingDraft}
          onClick={() => void saveDraft()}
          title="Keep it without sending"
        >
          <Save className="mr-1.5 inline h-4 w-4" />
          {savingDraft ? 'Saving…' : savedId ? 'Save draft' : 'Save as draft'}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={sending}
          onClick={() => void send()}
        >
          <Megaphone className="mr-1.5 inline h-4 w-4" />
          {sending ? 'Sending…' : 'Send broadcast'}
        </button>
      </div>
    </div>
  );
}
