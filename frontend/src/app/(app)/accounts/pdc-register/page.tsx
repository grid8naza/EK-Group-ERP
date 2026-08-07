'use client';

import { useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { DateInput, Input } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { formatDate, isoDate } from '@/lib/utils';
import { money } from '@/components/accounts/voucher-common';
import type { PdcStatus, VoucherInstrument } from '@/lib/types';

const ROUTE = '/accounts/pdc-register';

/** What each state looks like at a glance. */
const STATUS: Record<PdcStatus, { label: string; color: 'amber' | 'green' | 'slate' | 'violet' }> = {
  ISSUED: { label: 'Issued', color: 'amber' },
  CLEARED: { label: 'Cleared', color: 'green' },
  CANCELLED: { label: 'Cancelled', color: 'slate' },
  REPLACED: { label: 'Replaced', color: 'violet' },
};

type Action = 'clear' | 'cancel' | 'replace';

/** What each action is called, and what it wants said about it. */
const ACTIONS: Record<
  Action,
  { title: string; verb: string; dateLabel: string; needsReason: boolean; hint: string }
> = {
  clear: {
    title: 'Cheque cleared',
    verb: 'Mark cleared',
    dateLabel: 'Cleared on',
    needsReason: false,
    hint: 'The day the money actually left the bank — usually not the day written on the leaf. The entry taking it out of Post-dated Cheques Issued and into the bank is posted on that date.',
  },
  cancel: {
    title: 'Cheque cancelled',
    verb: 'Cancel it',
    dateLabel: 'Cancelled on',
    needsReason: true,
    hint: 'The voucher that issued it is cancelled, which puts the bill it was paying back where it was. Nothing else is posted — a cheque that never left is not a movement of money.',
  },
  replace: {
    title: 'Cheque replaced',
    verb: 'Mark replaced',
    dateLabel: 'Replaced on',
    needsReason: true,
    hint: 'The same as cancelling, recorded as a replacement so the register says which of the two happened. Write the new cheque as a fresh bank payment.',
  },
};

/**
 * The post-dated cheque register — every cheque written and not yet gone.
 *
 * A PDC is the one thing a voucher leaves behind: the entry is finished the day
 * it is posted, but the cheque goes on being a live promise for weeks, and
 * somebody has to be able to ask "what is due this week, and what has come
 * back". That question has no home on a voucher screen, so it has one here.
 *
 * The three things that can happen to it all happen from this screen, and each
 * writes its own date into the books — a cheque cleared on the second of
 * October is a payment on the second of October, whatever the leaf says.
 */
export default function PdcRegisterPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<PdcStatus | ''>('ISSUED');
  const query = status ? `?status=${status}` : '';
  const { data, loading, refetch } = useFetch<VoucherInstrument[]>(
    `/vouchers/pdc${query}`,
    [query],
  );

  const canEdit = can(ROUTE, 'edit');

  const [acting, setActing] = useState<{ row: VoucherInstrument; action: Action } | null>(null);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const openAction = (row: VoucherInstrument, action: Action) => {
    setActing({ row, action });
    setDate(isoDate(new Date()));
    setReason('');
  };

  const run = async () => {
    if (!acting) return;
    const spec = ACTIONS[acting.action];
    if (!date) return toast.error(`Give the date it was ${spec.dateLabel.toLowerCase()}.`);
    if (spec.needsReason && !reason.trim()) return toast.error('Say why.');
    setSaving(true);
    try {
      await api.patch(`/vouchers/pdc/${acting.row.id}/${acting.action}`, {
        date,
        ...(spec.needsReason ? { reason: reason.trim() } : {}),
      });
      toast.success(`${spec.title}.`);
      setActing(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed.');
    } finally {
      setSaving(false);
    }
  };

  /** Whose cheque it is — read off the line that moved a party's balance. */
  const partyLine = (r: VoucherInstrument) =>
    r.voucher?.lines?.find((l) => l.partyId)?.account?.name ?? '—';

  const columns: Column<VoucherInstrument>[] = useMemo(
    () => [
      {
        key: 'instrumentDate',
        header: 'Due',
        sortable: true,
        sortAccessor: (r) => r.instrumentDate ?? '',
        render: (r) => (
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {formatDate(r.instrumentDate)}
          </span>
        ),
      },
      { key: 'instrumentNo', header: 'Cheque no', accessor: (r) => r.instrumentNo ?? '—' },
      { key: 'bank', header: 'Drawn on', accessor: (r) => r.bankAccount?.name ?? '—' },
      { key: 'party', header: 'Against', accessor: partyLine },
      {
        key: 'amount',
        header: 'Amount',
        accessor: (r) => money(r.voucher?.totalCredit ?? 0),
      },
      {
        key: 'voucher',
        header: 'Voucher',
        accessor: (r) => r.voucher?.voucherNo ?? '—',
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => {
          const s = r.status ? STATUS[r.status] : null;
          return s ? <Badge color={s.color}>{s.label}</Badge> : <span>—</span>;
        },
      },
      {
        key: 'settledOn',
        header: 'Settled',
        accessor: (r) => (r.settledOn ? formatDate(r.settledOn) : '—'),
      },
    ],
    [],
  );

  const spec = acting ? ACTIONS[acting.action] : null;

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="PDC Register"
        description="Post-dated cheques written and not yet gone — what is due, and what has come back"
        icon={<CalendarClock className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            {(['ISSUED', 'CLEARED', 'CANCELLED', 'REPLACED', ''] as const).map((s) => (
              <button
                key={s || 'all'}
                className={s === status ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setStatus(s)}
              >
                {s ? STATUS[s].label : 'All'}
              </button>
            ))}
          </div>
        }
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search cheques..."
        emptyMessage="No cheques here"
        rowActions={(r) =>
          // Only a live cheque has anything left to do; the rest are history.
          canEdit && r.status === 'ISSUED' ? (
            <div className="flex items-center gap-1">
              <button className="btn-secondary" onClick={() => openAction(r, 'clear')}>
                Clear
              </button>
              <button className="btn-secondary" onClick={() => openAction(r, 'cancel')}>
                Cancel
              </button>
              <button className="btn-secondary" onClick={() => openAction(r, 'replace')}>
                Replace
              </button>
            </div>
          ) : null
        }
      />

      <Drawer
        open={!!acting}
        onClose={() => setActing(null)}
        title={spec?.title ?? ''}
        subtitle={
          acting
            ? `${acting.row.instrumentNo ?? 'Cheque'} · ${money(acting.row.voucher?.totalCredit ?? 0)}`
            : undefined
        }
        icon={<CalendarClock className="h-5 w-5" />}
        width="sm"
        footer={
          <DrawerFooter
            onCancel={() => setActing(null)}
            onSave={run}
            saving={saving}
            saveLabel={spec?.verb ?? 'Save'}
          />
        }
      >
        <ReadOnlyFieldset readOnly={false}>
          <div className="space-y-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">{spec?.hint}</p>
            <DateInput
              label={spec?.dateLabel ?? 'Date'}
              required
              value={date}
              onChange={setDate}
            />
            {spec?.needsReason && (
              <Input
                label="Reason"
                required
                value={reason}
                placeholder="Why the cheque did not go"
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </div>
        </ReadOnlyFieldset>
      </Drawer>
    </div>
  );
}
