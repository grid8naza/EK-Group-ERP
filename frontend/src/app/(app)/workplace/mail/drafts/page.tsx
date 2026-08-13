'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileEdit } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DraftList } from '@/components/workplace/DraftList';
import type { SavedMailDraft } from '@/lib/types';

/**
 * Drafts — mail started and not sent (SRS §8.11, FR-COM-01).
 *
 * Its own mailbox beside Inbox and Sent, because that is what a draft is: a
 * mail that has not gone anywhere. Opening one returns to the composer with its
 * content, which is where it can be finished, sent or thrown away.
 */
export default function MailDraftsPage() {
  const router = useRouter();
  const toast = useToast();
  const [drafts, setDrafts] = useState<SavedMailDraft[]>([]);
  const [loading, setLoading] = useState(true);

  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDrafts(await api.get<SavedMailDraft[]>('/mail/drafts'));
    } catch (e) {
      toastRef.current.error(
        e instanceof Error ? e.message : 'The drafts could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: number) => {
    try {
      await api.delete(`/mail/drafts/${id}`);
      setDrafts((list) => list.filter((d) => d.id !== id));
      toast.success('Draft deleted.');
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'The draft could not be deleted.',
      );
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col">
      <PageHeader
        title="Drafts"
        description="Mail you have started and not sent"
        icon={<FileEdit className="h-5 w-5" />}
      />
      <div className="min-h-0 flex-1 pb-4">
        <div className="h-full overflow-y-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <DraftList
            drafts={drafts.map((d) => ({
              id: d.id,
              title: d.subject,
              subline: d.to.length
                ? `To ${d.to.map((p) => p.name).join(', ')}`
                : 'Nobody addressed yet',
              updatedAt: d.updatedAt,
            }))}
            loading={loading}
            emptyMessage="Nothing half-written. Drafts you save while composing land here."
            onOpen={(id) => router.push(`/workplace/mail/new?draft=${id}`)}
            onDelete={(id) => void remove(id)}
          />
        </div>
      </div>
    </div>
  );
}
