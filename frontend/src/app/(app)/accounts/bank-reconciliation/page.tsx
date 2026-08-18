'use client';

import { useMemo, useState } from 'react';
import { Scale } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DateInput, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { formatDayMonthYear, isoDate } from '@/lib/utils';
import { money } from '@/components/accounts/voucher-common';
import type { CoaAccount } from '@/lib/types';

const ROUTE = '/accounts/bank-reconciliation';

/** One posting to the bank account, with the day the bank saw it if it has. */
interface ReconLine {
  id: number;
  date: string;
  bankDate: string | null;
  debit: number;
  credit: number;
  narration: string | null;
  voucher: {
    voucherNo: string;
    narration: string | null;
    reference: string | null;
    instrument: {
      instrumentNo: string | null;
      chequeKind: string | null;
    } | null;
  };
}

interface Recon {
  account: { id: number; code: string; name: string };
  asOn: string;
  perBooks: number;
  perBank: number;
  difference: number;
  lines: ReconLine[];
}

/**
 * Bank reconciliation — one account, as the books have it and as the bank does.
 *
 * The whole of it is one date per line. A cheque written on the 2nd and
 * presented on the 11th is in the books on the 2nd and on the statement on the
 * 11th, and both are true; typing the second date is what ties them together.
 * What is left without one IS the reconciliation statement, so there is nothing
 * to compute and nothing to keep in step — no second ledger, no ticking that
 * can drift from the entries it ticks.
 */
export default function BankReconciliationPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can(ROUTE, 'edit');

  const { data: accounts } = useFetch<CoaAccount[]>('/coa/accounts');
  const banks = useMemo(
    () =>
      (accounts ?? [])
        .filter((a) => a.isBank && a.adopted && a.isActive)
        .map((a) => ({ value: String(a.id), label: a.localName ?? a.name })),
    [accounts],
  );

  const [accountId, setAccountId] = useState('');
  const [asOn, setAsOn] = useState(isoDate(new Date()));
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  const query = accountId ? `?accountId=${accountId}&asOn=${asOn}` : null;
  const { data, loading, refetch } = useFetch<Recon>(
    query ? `/vouchers/bank-reconciliation${query}` : null,
    [query],
  );

  const rows = useMemo(() => {
    const all = data?.lines ?? [];
    // The reconciling items are the point of the screen, so they are what it
    // opens on; everything else is there to be looked up, not read through.
    return onlyOpen ? all.filter((l) => !l.bankDate) : all;
  }, [data, onlyOpen]);

  const setBankDate = async (line: ReconLine, bankDate: string | null) => {
    setBusy(line.id);
    try {
      await api.patch(`/vouchers/lines/${line.id}/bank-date`, { bankDate });
      await refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed.');
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<ReconLine>[] = useMemo(
    () => [
      {
        key: 'date',
        header: 'Book date',
        sortable: true,
        sortAccessor: (r) => r.date,
        accessor: (r) => formatDayMonthYear(r.date),
      },
      {
        key: 'voucherNo',
        header: 'Voucher',
        accessor: (r) => r.voucher.voucherNo,
      },
      {
        key: 'particulars',
        header: 'Particulars',
        accessor: (r) =>
          [
            r.voucher.instrument?.instrumentNo &&
              `Cheque ${r.voucher.instrument.instrumentNo}`,
            r.narration || r.voucher.narration || r.voucher.reference,
          ]
            .filter(Boolean)
            .join(' · ') || '—',
      },
      {
        key: 'debit',
        header: 'Deposit',
        accessor: (r) => (r.debit ? money(r.debit) : ''),
      },
      {
        key: 'credit',
        header: 'Withdrawal',
        accessor: (r) => (r.credit ? money(r.credit) : ''),
      },
      {
        key: 'bankDate',
        header: 'Bank date',
        render: (r) =>
          canEdit ? (
            // Typed straight into the row: reconciling is one date after
            // another down a statement, and a drawer for each would double the
            // work of the only thing this screen does.
            <DateInput
              value={r.bankDate?.slice(0, 10) ?? ''}
              disabled={busy === r.id}
              className="h-8 w-32 text-sm"
              onChange={(v) => {
                if (v && v !== r.bankDate?.slice(0, 10)) setBankDate(r, v);
              }}
            />
          ) : (
            <span>{r.bankDate ? formatDayMonthYear(r.bankDate) : '—'}</span>
          ),
      },
      {
        key: 'status',
        header: '',
        render: (r) =>
          r.bankDate ? (
            <button
              className="text-xs text-slate-400 hover:text-rose-600"
              title="It was not on the statement after all"
              disabled={!canEdit || busy === r.id}
              onClick={() => setBankDate(r, null)}
            >
              Undo
            </button>
          ) : (
            <Badge color="amber">Not yet</Badge>
          ),
      },
    ],
    [canEdit, busy],
  );

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Bank Reconciliation"
        description="What the books say against what the bank says, and the entries between them"
        icon={<Scale className="h-5 w-5" />}
      />

      <div className="card mb-3 grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
        <Select
          label="Bank account"
          required
          value={accountId}
          options={banks}
          placeholder={
            banks.length ? 'Which account?' : 'No bank account in use'
          }
          onChange={(e) => setAccountId(e.target.value)}
        />
        <DateInput
          label="Reconcile to"
          required
          value={asOn}
          onChange={setAsOn}
        />
        <div className="flex items-end">
          <button
            className={onlyOpen ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setOnlyOpen((v) => !v)}
          >
            {onlyOpen ? 'Showing what is unreconciled' : 'Showing everything'}
          </button>
        </div>
      </div>

      {/* The statement itself, in the order it is read: what the books say,
          what the bank says, and the difference the list below accounts for. */}
      {data && (
        <div className="card mb-3 grid grid-cols-1 gap-4 p-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Balance as per books
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {money(data.perBooks)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Balance as per bank
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {money(data.perBank)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Difference — the entries below
            </p>
            <p
              className={
                data.difference === 0
                  ? 'text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400'
                  : 'text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400'
              }
            >
              {money(data.difference)}
            </p>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search entries..."
        emptyMessage={
          accountId
            ? onlyOpen
              ? 'Nothing left to reconcile'
              : 'No entries to this account yet'
            : 'Choose a bank account'
        }
      />
    </div>
  );
}
