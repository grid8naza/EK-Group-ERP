'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  BookOpenCheck,
  Check,
  Plus,
  Trash2,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type {
  CoaAccount,
  CostCenter,
  CostObject,
  Voucher,
  VoucherStatus,
  VoucherType,
} from '@/lib/types';

const ROUTE = '/accounts/vouchers';

type Mode = 'list' | 'edit' | 'view';

/** A line as the form holds it — amounts as text until they are saved. */
type DraftLine = {
  accountId: string;
  side: 'DR' | 'CR';
  amount: string;
  costCenterId: string;
  costObjectId: string;
  narration: string;
};

const emptyLine = (): DraftLine => ({
  accountId: '',
  side: 'DR',
  amount: '',
  costCenterId: '',
  costObjectId: '',
  narration: '',
});

const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
const money = (v: string | number) =>
  num(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const today = () => new Date().toISOString().slice(0, 10);
const asDate = (iso: string) => new Date(iso).toLocaleDateString();

const statusColor = (s: VoucherStatus) =>
  s === 'POSTED' ? 'green' : s === 'CANCELLED' ? 'slate' : 'blue';

/**
 * Voucher entry — where the books are written.
 *
 * A voucher is a balanced statement, so the form is built around that one fact:
 * the totals sit under the lines and Post is refused until they agree. A draft
 * is scratch paper and may be rewritten or thrown away; once posted it is a
 * record, and the only thing left to do with it is cancel it — which marks it
 * and keeps it, because the books have to say what they said.
 */
export function VoucherScreen() {
  const { can, activeCompany } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: types } = useFetch<VoucherType[]>('/vouchers/types');
  const { data: accounts } = useFetch<CoaAccount[]>('/coa/accounts');
  const { data: centres } = useFetch<CostCenter[]>('/cost-centers');
  const { data: objects } = useFetch<CostObject[]>('/cost-objects');

  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const query = [
    typeFilter ? `typeId=${typeFilter}` : '',
    statusFilter ? `status=${statusFilter}` : '',
  ]
    .filter(Boolean)
    .join('&');
  const {
    data: rows,
    loading,
    refetch,
  } = useFetch<Voucher[]>(`/vouchers${query ? `?${query}` : ''}`, [query]);

  const [mode, setMode] = useState<Mode>('list');
  const [editing, setEditing] = useState<Voucher | null>(null);
  const [saving, setSaving] = useState(false);

  const [typeId, setTypeId] = useState('');
  const [date, setDate] = useState(today());
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');

  // Only accounts this company posts to, and only those that take a
  // hand-written entry — the rest would be refused on save anyway.
  const postable = useMemo(
    () =>
      (accounts ?? []).filter(
        (a) => a.adopted && a.isActive && a.allowManualJe && a.allowPosting !== false,
      ),
    [accounts],
  );
  const accountById = useMemo(
    () => new Map(postable.map((a) => [a.id, a])),
    [postable],
  );
  const accountOptions = useMemo(
    () =>
      postable.map((a) => ({
        value: String(a.id),
        label: `${a.code} · ${a.localName ?? a.name}`,
      })),
    [postable],
  );

  useEffect(() => {
    if (!typeId && types?.length) setTypeId(String(types[0].id));
  }, [types, typeId]);

  const startNew = () => {
    setEditing(null);
    setTypeId(types?.length ? String(types[0].id) : '');
    setDate(today());
    setNarration('');
    setLines([emptyLine(), emptyLine()]);
    setMode('edit');
  };

  const open = (v: Voucher, next: Mode) => {
    setEditing(v);
    setTypeId(String(v.voucherTypeId));
    setDate(v.date.slice(0, 10));
    setNarration(v.narration ?? '');
    setLines(
      v.lines.map((l) => ({
        accountId: String(l.accountId),
        side: num(l.debit) > 0 ? 'DR' : 'CR',
        amount: String(num(l.debit) > 0 ? num(l.debit) : num(l.credit)),
        costCenterId: l.costCenterId ? String(l.costCenterId) : '',
        costObjectId: l.costObjectId ? String(l.costObjectId) : '',
        narration: l.narration ?? '',
      })),
    );
    setMode(next);
  };

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)));

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const l of lines) {
      const amount = Math.round(num(l.amount) * 100);
      if (l.side === 'DR') dr += amount;
      else cr += amount;
    }
    return { dr: dr / 100, cr: cr / 100, diff: (dr - cr) / 100 };
  }, [lines]);
  const balanced = totals.diff === 0 && totals.dr > 0;

  /** What each line is asked for, from the account it names. */
  const asksFor = (l: DraftLine) => {
    const account = accountById.get(Number(l.accountId));
    return {
      centre: account?.entryRules
        ? account.entryRules.costCenter === 'REQUIRED'
        : false,
      object: account?.entryRules
        ? account.entryRules.costObject === 'REQUIRED'
        : false,
    };
  };

  const body = () => ({
    voucherTypeId: Number(typeId),
    date,
    narration,
    lines: lines
      .filter((l) => l.accountId && num(l.amount) > 0)
      .map((l) => ({
        accountId: Number(l.accountId),
        debit: l.side === 'DR' ? num(l.amount) : 0,
        credit: l.side === 'CR' ? num(l.amount) : 0,
        costCenterId: l.costCenterId ? Number(l.costCenterId) : undefined,
        costObjectId: l.costObjectId ? Number(l.costObjectId) : undefined,
        narration: l.narration || undefined,
      })),
  });

  const save = async (post: boolean) => {
    const payload = body();
    if (!payload.voucherTypeId) return toast.error('Choose a voucher type.');
    if (payload.lines.length < 2) {
      return toast.error('A voucher needs at least two lines.');
    }
    if (post && !balanced) {
      return toast.error('Debits and credits must agree before posting.');
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/vouchers/${editing.id}`, { ...payload, post });
      } else {
        await api.post('/vouchers', { ...payload, post });
      }
      toast.success(post ? 'Voucher posted.' : 'Draft saved.');
      await refetch();
      setMode('list');
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const postExisting = async (v: Voucher) => {
    try {
      await api.patch(`/vouchers/${v.id}/post`, {});
      toast.success(`${v.voucherNo} posted.`);
      await refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to post.');
    }
  };

  const cancel = async (v: Voucher) => {
    const ok = await confirm({
      title: 'Cancel voucher',
      message:
        `Cancel ${v.voucherNo}? It stays in the books, marked cancelled — a ` +
        `posted voucher is never removed.`,
      confirmText: 'Cancel it',
      cancelText: 'Keep',
      danger: true,
      defaultCancel: true,
    });
    if (!ok) return;
    try {
      await api.patch(`/vouchers/${v.id}/cancel`, {
        reason: 'Cancelled from Voucher Entry',
      });
      toast.success('Voucher cancelled.');
      await refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to cancel.');
    }
  };

  const remove = async (v: Voucher) => {
    const ok = await confirm({
      title: 'Delete draft',
      message: `Delete draft ${v.voucherNo}? It has not reached the books.`,
      confirmText: 'Delete',
      danger: true,
      defaultCancel: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/vouchers/${v.id}`);
      toast.success('Draft deleted.');
      await refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // ---- listing ----------------------------------------------------------------

  const columns: Column<Voucher>[] = [
    {
      key: 'voucherNo',
      header: 'Voucher No',
      className: 'font-medium',
      accessor: (v) => v.voucherNo,
    },
    {
      key: 'date',
      header: 'Date',
      accessor: (v) => v.date,
      render: (v) => asDate(v.date),
    },
    {
      key: 'type',
      header: 'Type',
      accessor: (v) => v.type?.name ?? '',
      render: (v) => (
        <span className="text-sm text-slate-600 dark:text-slate-300">
          {v.type?.name ?? '—'}
        </span>
      ),
    },
    {
      key: 'narration',
      header: 'Narration',
      accessor: (v) => v.narration ?? '',
      render: (v) => (
        <div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            {v.narration || '—'}
          </div>
          <div className="text-xs text-slate-400">
            {v.lines.length} line{v.lines.length === 1 ? '' : 's'}
            {v.lines[0]?.account
              ? ` · ${v.lines[0].account.code} ${v.lines[0].account.name}`
              : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      headerClassName: 'text-right',
      className: 'text-right tabular-nums',
      sortAccessor: (v) => num(v.totalDebit),
      render: (v) => money(v.totalDebit),
    },
    {
      key: 'status',
      header: 'Status',
      headerClassName: 'text-center',
      className: 'text-center',
      accessor: (v) => v.status,
      render: (v) => (
        <Badge color={statusColor(v.status)}>
          {v.status === 'DRAFT'
            ? 'Draft'
            : v.status === 'POSTED'
              ? 'Posted'
              : 'Cancelled'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      sortable: false,
      className: 'w-32',
      render: (v) => (
        <div className="flex items-center justify-end gap-1">
          {v.status === 'DRAFT' && canEdit && (
            <button
              className="rounded px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
              title="Write it to the books"
              onClick={(e) => {
                e.stopPropagation();
                void postExisting(v);
              }}
            >
              Post
            </button>
          )}
          {v.status === 'POSTED' && canEdit && (
            <button
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
              title="Cancel this voucher"
              onClick={(e) => {
                e.stopPropagation();
                void cancel(v);
              }}
            >
              <Ban className="h-4 w-4" />
            </button>
          )}
          {v.status === 'DRAFT' && canDelete && (
            <button
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
              title="Delete this draft"
              onClick={(e) => {
                e.stopPropagation();
                void remove(v);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  if (mode === 'list') {
    return (
      <div className="flex h-full flex-col">
        <PageHeader
          title="Voucher Entry"
          description="Hand-written entries into the general ledger — journal, payment, receipt and contra"
          icon={<BookOpenCheck className="h-5 w-5" />}
          actions={
            canAdd ? (
              <button className="btn-primary" onClick={startNew}>
                <Plus className="mr-1 inline h-4 w-4" />
                New Voucher
              </button>
            ) : null
          }
        />
        <div className="min-h-0 flex-1">
          <DataTable
            columns={columns}
            rows={rows ?? []}
            rowKey={(v) => v.id}
            loading={loading}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search voucher no or narration…"
            onRefresh={refetch}
            onRowClick={(v) => open(v, v.status === 'DRAFT' ? 'edit' : 'view')}
            emptyMessage="No vouchers yet."
            toolbar={
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  options={(types ?? []).map((t) => ({
                    value: String(t.id),
                    label: t.name,
                  }))}
                  placeholder="All types"
                  className="w-52"
                />
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  options={[
                    { value: 'DRAFT', label: 'Draft' },
                    { value: 'POSTED', label: 'Posted' },
                    { value: 'CANCELLED', label: 'Cancelled' },
                  ]}
                  placeholder="Any status"
                  className="w-40"
                />
              </div>
            }
          />
        </div>
      </div>
    );
  }

  // ---- entry form -------------------------------------------------------------

  const readOnly = mode === 'view';
  const typeName =
    (types ?? []).find((t) => String(t.id) === typeId)?.name ?? 'Voucher';

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={editing ? `${editing.voucherNo} — ${typeName}` : `New ${typeName}`}
        description={
          readOnly
            ? 'Posted — a correction is a fresh voucher, never an edit to this one'
            : 'Every line carries one side. The voucher posts once the two agree.'
        }
        icon={<BookOpenCheck className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary"
              onClick={() => {
                setMode('list');
                setEditing(null);
              }}
            >
              <ArrowLeft className="mr-1 inline h-4 w-4" />
              Back
            </button>
            {!readOnly && (
              <>
                <button
                  className="btn-secondary"
                  disabled={saving}
                  onClick={() => void save(false)}
                >
                  Save draft
                </button>
                <button
                  className="btn-primary"
                  disabled={saving || !balanced}
                  title={balanced ? 'Write it to the books' : 'It does not balance yet'}
                  onClick={() => void save(true)}
                >
                  <Check className="mr-1 inline h-4 w-4" />
                  Post
                </button>
              </>
            )}
          </div>
        }
      />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6">
        <div className="card grid grid-cols-1 gap-4 p-4 sm:grid-cols-4">
          <Select
            label="Voucher type"
            required
            value={typeId}
            disabled={readOnly || !!editing}
            onChange={(e) => setTypeId(e.target.value)}
            options={(types ?? []).map((t) => ({
              value: String(t.id),
              label: t.name,
            }))}
          />
          <Input
            type="date"
            label="Date"
            required
            value={date}
            disabled={readOnly}
            onChange={(e) => setDate(e.target.value)}
          />
          <Textarea
            label="Narration"
            rows={1}
            value={narration}
            disabled={readOnly}
            onChange={(e) => setNarration(e.target.value)}
            wrapClassName="sm:col-span-2"
          />
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="w-[28%] px-3 py-2 text-left">Account</th>
                <th className="w-[8%] px-3 py-2 text-left">Dr/Cr</th>
                <th className="w-[14%] px-3 py-2 text-right">Amount</th>
                <th className="w-[16%] px-3 py-2 text-left">Cost Centre</th>
                <th className="w-[16%] px-3 py-2 text-left">Cost Object</th>
                <th className="px-3 py-2 text-left">Narration</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const asks = asksFor(l);
                const centreOptions = (centres ?? [])
                  .filter((c) => c.isActive)
                  .map((c) => ({ value: String(c.id), label: c.name }));
                const objectOptions = (objects ?? [])
                  .filter(
                    (o) =>
                      o.isActive && String(o.costCenterId) === l.costCenterId,
                  )
                  .map((o) => ({ value: String(o.id), label: o.name }));
                return (
                  <tr
                    key={i}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    <td className="px-2 py-1.5">
                      <Select
                        value={l.accountId}
                        disabled={readOnly}
                        onChange={(e) =>
                          setLine(i, {
                            accountId: e.target.value,
                            costCenterId: '',
                            costObjectId: '',
                          })
                        }
                        options={accountOptions}
                        placeholder="Choose an account"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={l.side}
                        disabled={readOnly}
                        onChange={(e) =>
                          setLine(i, { side: e.target.value as 'DR' | 'CR' })
                        }
                        options={[
                          { value: 'DR', label: 'Dr' },
                          { value: 'CR', label: 'Cr' },
                        ]}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={l.amount}
                        disabled={readOnly}
                        onChange={(e) => setLine(i, { amount: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {/* Offered only where the account asks for it — the same
                          two checkpoints the server enforces. */}
                      {asks.centre ? (
                        <Select
                          value={l.costCenterId}
                          disabled={readOnly}
                          onChange={(e) =>
                            setLine(i, {
                              costCenterId: e.target.value,
                              costObjectId: '',
                            })
                          }
                          options={centreOptions}
                          placeholder="Required"
                        />
                      ) : (
                        <span className="px-1 text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {asks.object ? (
                        <Select
                          value={l.costObjectId}
                          disabled={readOnly || !l.costCenterId}
                          onChange={(e) =>
                            setLine(i, { costObjectId: e.target.value })
                          }
                          options={objectOptions}
                          placeholder={l.costCenterId ? 'Required' : 'Centre first'}
                        />
                      ) : (
                        <span className="px-1 text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={l.narration}
                        disabled={readOnly}
                        onChange={(e) => setLine(i, { narration: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {!readOnly && lines.length > 2 && (
                        <button
                          className="rounded p-1 text-slate-400 hover:text-rose-600"
                          title="Remove this line"
                          onClick={() =>
                            setLines((ls) => ls.filter((_, x) => x !== i))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800/60">
                <td className="px-3 py-2" colSpan={2}>
                  {!readOnly && (
                    <button
                      className="text-xs font-normal text-brand-600 hover:underline"
                      onClick={() => setLines((ls) => [...ls, emptyLine()])}
                    >
                      + Add line
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <div className="text-slate-500">Dr {money(totals.dr)}</div>
                  <div className="text-slate-500">Cr {money(totals.cr)}</div>
                </td>
                <td className="px-3 py-2" colSpan={4}>
                  <span
                    className={cn(
                      'text-sm',
                      balanced
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400',
                    )}
                  >
                    {balanced
                      ? 'Balanced'
                      : totals.dr === 0 && totals.cr === 0
                        ? 'Nothing entered yet'
                        : `Out by ${money(Math.abs(totals.diff))}`}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {editing?.status === 'CANCELLED' && editing.cancelReason && (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            Cancelled — {editing.cancelReason}
          </p>
        )}
        <p className="text-xs text-slate-400">
          {activeCompany?.name ?? 'This company'} · a cost centre or object is
          asked for only where the account calls for one.
        </p>
      </div>
    </div>
  );
}
