'use client';

import { useMemo, useState } from 'react';
import { CalendarClock, History } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer, DrawerFooter, CloseFooter } from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { DateInput, Input } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { formatDate, isoDate } from '@/lib/utils';
import { money } from '@/components/accounts/voucher-common';
import type { PdcStatus, VoucherInstrument } from '@/lib/types';

type Tone = 'amber' | 'green' | 'slate' | 'violet' | 'blue' | 'red';

/**
 * The eight states, as they read and as they look.
 *
 * `moves` is the same table the server holds — which moves are open from where.
 * Kept in step by both being short and both being about one idea; the server is
 * the one that decides, and a button this screen offers wrongly is refused
 * there with the same words.
 */
const STATUS: Record<
  PdcStatus,
  { label: string; tone: Tone; moves: PdcStatus[] }
> = {
  ISSUED: {
    label: 'Issued',
    tone: 'amber',
    moves: ['CLEARED', 'REPLACED', 'CANCELLED'],
  },
  IN_HAND: {
    label: 'In hand',
    tone: 'amber',
    moves: ['SUBMITTED', 'REPLACED', 'CANCELLED'],
  },
  SUBMITTED: {
    label: 'Submitted',
    tone: 'blue',
    moves: ['CLEARED', 'BOUNCED'],
  },
  BOUNCED: {
    label: 'Bounced',
    tone: 'red',
    moves: ['RESUBMITTED', 'REPLACED', 'CANCELLED'],
  },
  RESUBMITTED: {
    label: 'Resubmitted',
    tone: 'blue',
    moves: ['CLEARED', 'BOUNCED'],
  },
  CLEARED: { label: 'Cleared', tone: 'green', moves: [] },
  REPLACED: { label: 'Replaced', tone: 'violet', moves: [] },
  CANCELLED: { label: 'Cancelled', tone: 'slate', moves: [] },
};

/** What each move asks for, and what it will do to the books. */
const MOVES: Record<
  PdcStatus,
  { verb: string; dateLabel: string; needsRemark: boolean; hint: string }
> = {
  SUBMITTED: {
    verb: 'Submit',
    dateLabel: 'Banked on',
    needsRemark: false,
    hint: 'The cheque has gone to the bank. Nothing is posted — a cheque banked is still not money, and the entry that took it in already said what it was worth.',
  },
  CLEARED: {
    verb: 'Mark cleared',
    dateLabel: 'Cleared on',
    needsRemark: false,
    hint: 'The day the money actually moved — usually not the day written on the leaf. The entry between the post-dated cheque ledger and the bank is posted on that date.',
  },
  BOUNCED: {
    verb: 'Mark bounced',
    dateLabel: 'Returned on',
    needsRemark: true,
    hint: 'It came back unpaid. Nothing is posted: the cheque can still be presented again, and the entry that took it in stands until somebody says the debt is off.',
  },
  RESUBMITTED: {
    verb: 'Resubmit',
    dateLabel: 'Banked again on',
    needsRemark: false,
    hint: 'Round it goes again. It may clear or bounce as many times as the patience lasts, and every pass is kept.',
  },
  REPLACED: {
    verb: 'Mark replaced',
    dateLabel: 'Replaced on',
    needsRemark: true,
    hint: 'Another cheque was written for the same debt. The voucher that took this one is cancelled, which puts the bill it was settling back where it was. Enter the new cheque as a fresh voucher.',
  },
  CANCELLED: {
    verb: 'Cancel it',
    dateLabel: 'Cancelled on',
    needsRemark: true,
    hint: 'The end of it. The voucher that took or wrote it is cancelled, and the bill stands open again.',
  },
  // Never offered as a move — a cheque arrives in one of these.
  ISSUED: { verb: '', dateLabel: '', needsRemark: false, hint: '' },
  IN_HAND: { verb: '', dateLabel: '', needsRemark: false, hint: '' },
};

/**
 * The post-dated cheque register — every cheque written or taken in, and where
 * it has got to.
 *
 * A PDC is the one thing a voucher leaves behind: the entry is finished the day
 * it is posted, but the cheque goes on being a live promise for weeks. A cheque
 * we were GIVEN especially — it waits in a drawer, goes to the bank, comes back
 * unpaid, goes again — and "why is that customer's money three weeks late" is
 * answered by the whole of that history, not by its last line. So every move is
 * kept, with the day it happened and a word about why.
 */
export function PdcRegister({
  side,
  route,
  title,
  description,
}: {
  /** Cheques this company WROTE, or ones it was GIVEN. */
  side: 'ISSUED' | 'RECEIVED';
  route: string;
  title: string;
  description: string;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<PdcStatus | 'LIVE' | ''>('LIVE');
  const query = [
    `side=${side}`,
    status && status !== 'LIVE' ? `status=${status}` : '',
  ]
    .filter(Boolean)
    .join('&');
  const { data, loading, refetch } = useFetch<VoucherInstrument[]>(
    `/vouchers/pdc?${query}`,
    [query],
  );

  const canEdit = can(route, 'edit');

  const [acting, setActing] = useState<{
    row: VoucherInstrument;
    to: PdcStatus;
  } | null>(null);
  const [history, setHistory] = useState<VoucherInstrument | null>(null);
  const [date, setDate] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => {
    const all = data ?? [];
    // "Live" is the question the register is actually opened to ask: what is
    // still out there. It is every state that has somewhere left to go.
    return status === 'LIVE'
      ? all.filter((r) => r.status && STATUS[r.status].moves.length > 0)
      : all;
  }, [data, status]);

  const openMove = (row: VoucherInstrument, to: PdcStatus) => {
    setActing({ row, to });
    setDate(isoDate(new Date()));
    setRemark('');
  };

  const run = async () => {
    if (!acting) return;
    const spec = MOVES[acting.to];
    if (!date)
      return toast.error(
        `Give the date it was ${spec.dateLabel.toLowerCase()}.`,
      );
    if (spec.needsRemark && !remark.trim())
      return toast.error('Say why, in a word or two.');
    setSaving(true);
    try {
      await api.patch(`/vouchers/pdc/${acting.row.id}`, {
        status: acting.to,
        date,
        remark: remark.trim() || undefined,
      });
      toast.success(`${STATUS[acting.to].label}.`);
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
      {
        key: 'instrumentNo',
        header: 'Cheque no',
        accessor: (r) => r.instrumentNo ?? '—',
      },
      {
        key: 'bank',
        header: 'Bank',
        accessor: (r) => r.bankAccount?.name ?? '—',
      },
      { key: 'party', header: 'Against', accessor: partyLine },
      {
        key: 'amount',
        header: 'Amount',
        accessor: (r) => money(r.voucher?.totalCredit ?? 0),
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => {
          const s = r.status ? STATUS[r.status] : null;
          if (!s) return <span>—</span>;
          // The date of the last move, beside it: a cheque that has been
          // "submitted" for five weeks is a different thing from one submitted
          // yesterday, and the status alone cannot say which.
          const since = r.events?.at(-1)?.date;
          return (
            <div>
              <Badge color={s.tone}>{s.label}</Badge>
              {since && (
                <span className="ml-2 text-xs text-slate-400">
                  {formatDate(since)}
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: 'remark',
        header: 'Last remark',
        accessor: (r) => r.events?.at(-1)?.remark ?? '—',
      },
    ],
    [],
  );

  const spec = acting ? MOVES[acting.to] : null;

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title={title}
        description={description}
        icon={<CalendarClock className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {(side === 'RECEIVED'
              ? (['LIVE', 'SUBMITTED', 'BOUNCED', 'CLEARED', ''] as const)
              : (['LIVE', 'CLEARED', 'CANCELLED', ''] as const)
            ).map((s) => (
              <button
                key={s || 'all'}
                className={s === status ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setStatus(s)}
              >
                {s === 'LIVE' ? 'Live' : s ? STATUS[s].label : 'All'}
              </button>
            ))}
          </div>
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search cheques..."
        emptyMessage="No cheques here"
        rowActions={(r) => (
          <div className="flex items-center gap-1">
            <button
              className="btn-secondary"
              title="Everything that has happened to it"
              onClick={() => setHistory(r)}
            >
              <History className="h-4 w-4" />
            </button>
            {/* Only the moves open from where it is. The rest are not greyed
                out — they are not choices at all from here. */}
            {canEdit &&
              (r.status ? STATUS[r.status].moves : []).map((to) => (
                <button
                  key={to}
                  className="btn-secondary"
                  onClick={() => openMove(r, to)}
                >
                  {MOVES[to].verb}
                </button>
              ))}
          </div>
        )}
      />

      <Drawer
        open={!!acting}
        onClose={() => setActing(null)}
        title={acting ? STATUS[acting.to].label : ''}
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
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {spec?.hint}
            </p>
            <DateInput
              label={spec?.dateLabel ?? 'Date'}
              required
              value={date}
              onChange={setDate}
            />
            <Input
              label="Remark"
              required={spec?.needsRemark}
              value={remark}
              placeholder="Returned unpaid — funds insufficient"
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>
        </ReadOnlyFieldset>
      </Drawer>

      {/* The whole life of one cheque, oldest first. */}
      <Drawer
        open={!!history}
        onClose={() => setHistory(null)}
        title={history?.instrumentNo ?? 'Cheque'}
        subtitle={
          history
            ? `${history.bankAccount?.name ?? ''} · ${money(history.voucher?.totalCredit ?? 0)}`
            : undefined
        }
        icon={<History className="h-5 w-5" />}
        width="sm"
        footer={<CloseFooter onClose={() => setHistory(null)} />}
      >
        <ol className="space-y-3">
          {(history?.events ?? []).map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="w-24 flex-none text-xs tabular-nums text-slate-400">
                {formatDate(e.date)}
              </span>
              <span className="min-w-0">
                <Badge color={STATUS[e.status].tone}>
                  {STATUS[e.status].label}
                </Badge>
                {e.remark && (
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                    {e.remark}
                  </span>
                )}
              </span>
            </li>
          ))}
          {!history?.events?.length && (
            <li className="text-sm text-slate-400">Nothing recorded yet.</li>
          )}
        </ol>
      </Drawer>
    </div>
  );
}
