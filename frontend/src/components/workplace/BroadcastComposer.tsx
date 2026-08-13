'use client';

import { useState } from 'react';
import { Megaphone } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { DateInput } from '@/components/ui/Field';
import { RichTextEditor } from '@/components/ui/RichText';
import { AudienceField } from '@/components/workplace/AudienceField';
import { PRIORITIES } from '@/components/workplace/broadcast-ui';
import { cn } from '@/lib/utils';
import type { Audience, Broadcast, BroadcastPriority } from '@/lib/types';

/**
 * Send one announcement — the Send Broadcast screen's whole body.
 *
 * Shorter than the circular composer on purpose, and it asks for less: no
 * acknowledgement, no attachment, no reference. What it does ask that the
 * circular does not is how long it should stay up, because an announcement that
 * never goes away is how a feed of them stops being read.
 */
export function BroadcastComposer({
  onSent,
}: {
  onSent: (broadcast: Broadcast) => void;
}) {
  const toast = useToast();

  const [audience, setAudience] = useState<Audience>({});
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<BroadcastPriority>('NORMAL');
  const [expiresAt, setExpiresAt] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (sending) return;
    if (!title.trim()) {
      toast.error('Give the broadcast a title.');
      return;
    }
    try {
      setSending(true);
      const broadcast = await api.post<Broadcast>('/broadcasts', {
        title: title.trim(),
        body,
        audience,
        priority,
        expiresAt: expiresAt || undefined,
      });
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
