'use client';

import { useRef, useState } from 'react';
import { Megaphone, Paperclip, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { DateInput } from '@/components/ui/Field';
import { RichTextEditor } from '@/components/ui/RichText';
import { humanSize } from '@/components/workplace/people';
import { AudienceField } from '@/components/workplace/AudienceField';
import type { Circular, CircularAttachmentRef, Audience } from '@/lib/types';

/**
 * Issue one circular — the Send Circular screen's whole body.
 *
 * The order of the form is the order of the decision: who it is for, what it
 * says, whether they must acknowledge it. Audience first because it is the one
 * thing that cannot be fixed afterwards — a circular that has gone to 240 people
 * has gone, and there is no unsending a formal notice.
 */
export function CircularComposer({
  onIssued,
}: {
  onIssued: (circular: Circular) => void;
}) {
  const toast = useToast();

  const [audience, setAudience] = useState<Audience>({});
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [requiresAck, setRequiresAck] = useState(true);
  const [ackDueAt, setAckDueAt] = useState('');
  const [attachments, setAttachments] = useState<CircularAttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadFiles = async (files: FileList) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        const saved = await api.post<CircularAttachmentRef>(
          '/circulars/attachments',
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

  const issue = async () => {
    if (issuing) return;
    if (!title.trim()) {
      toast.error('Give the circular a title.');
      return;
    }
    try {
      setIssuing(true);
      const circular = await api.post<Circular>('/circulars', {
        title: title.trim(),
        body,
        audience,
        requiresAck,
        // A date is only meaningful when an acknowledgement is asked for.
        ackDueAt: requiresAck && ackDueAt ? ackDueAt : undefined,
        attachments,
      });
      toast.success(`Circular ${circular.reference} issued.`);
      onIssued(circular);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'The circular was not issued.',
      );
    } finally {
      setIssuing(false);
    }
  };

  return (
    // The fields scroll; the actions do not. A form long enough to scroll is a
    // form where "Issue circular" would otherwise be somewhere off the bottom
    // of the screen.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <AudienceField
          value={audience}
          onChange={setAudience}
          optionsEndpoint="/circulars/audience"
          previewEndpoint="/circulars/audience/preview"
          directoryEndpoint="/circulars/directory"
        />

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What the notice is about"
            maxLength={200}
            className="input-base w-full"
          />
        </div>

        {/* A plain block, NOT flex-1: the form is a scrolling column, and a child
          asking to fill it gets a basis of zero and is squeezed under the
          controls below instead of pushing them down. */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Notice
          </label>
          <RichTextEditor
            value={body}
            onChange={setBody}
            placeholder="Write the circular…"
            minHeight={220}
          />
        </div>

        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={requiresAck}
              onChange={(e) => setRequiresAck(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            Ask everyone to acknowledge it
          </label>
          {requiresAck && (
            <div className="w-44">
              <DateInput
                label="Acknowledge by"
                value={ackDueAt}
                onChange={setAckDueAt}
              />
            </div>
          )}
          <p className="flex-1 text-xs text-slate-400">
            {requiresAck
              ? 'Each person confirms they have seen it, and you get the register.'
              : 'It is issued for information — the register shows who has read it.'}
          </p>
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
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
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
        <button
          type="button"
          className="btn-primary"
          disabled={issuing || uploading}
          onClick={() => void issue()}
        >
          <Megaphone className="mr-1.5 inline h-4 w-4" />
          {issuing ? 'Issuing…' : 'Issue circular'}
        </button>
      </div>
    </div>
  );
}
