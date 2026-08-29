'use client';

import { useMemo, useState } from 'react';
import { FileSignature, Plus, Trash2, ArrowLeft } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDayMonthYear } from '@/lib/utils';
import { useFetch, useUnsavedChangesGuard } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { FormSection } from '@/components/ui/FormSection';
import {
  Checkbox,
  DateInput,
  Input,
  Select,
  Textarea,
} from '@/components/ui/Field';
import type { Branch, Customer, Product } from '@/lib/types';

const ROUTE = '/crm/contracts';

type ContractStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'CANCELLED';

/** The days a line is supplied on. Sunday first, as JS counts weekdays. */
const DAYS = [
  { key: 'supSun', label: 'Sun' },
  { key: 'supMon', label: 'Mon' },
  { key: 'supTue', label: 'Tue' },
  { key: 'supWed', label: 'Wed' },
  { key: 'supThu', label: 'Thu' },
  { key: 'supFri', label: 'Fri' },
  { key: 'supSat', label: 'Sat' },
] as const;
type DayKey = (typeof DAYS)[number]['key'];

interface ContractLine {
  id?: number;
  productId: number;
  productCode?: string | null;
  productName?: string | null;
  quantity: number;
  unitId: number;
  unitSymbol?: string;
  rate: number;
  supSun: boolean;
  supMon: boolean;
  supTue: boolean;
  supWed: boolean;
  supThu: boolean;
  supFri: boolean;
  supSat: boolean;
}

interface Contract {
  id: number;
  companyId: number;
  branchId: number | null;
  contractNo: string;
  customerId: number;
  customerCode: string | null;
  customerName: string | null;
  title: string | null;
  startDate: string;
  endDate: string;
  status: ContractStatus;
  notes: string | null;
  isLocked: boolean;
  lines: ContractLine[];
}

type DraftLine = {
  productId: string;
  quantity: string;
  rate: string;
} & Record<DayKey, boolean>;

const emptyLine = (): DraftLine => ({
  productId: '',
  quantity: '',
  rate: '',
  supSun: false,
  supMon: false,
  supTue: false,
  supWed: false,
  supThu: false,
  supFri: false,
  supSat: false,
});

const statusColor = (s: ContractStatus) =>
  s === 'ACTIVE'
    ? 'green'
    : s === 'DRAFT'
      ? 'blue'
      : s === 'SUSPENDED'
        ? 'amber'
        : 'slate';

/**
 * Supply contracts — the standing agreements behind institutional customers.
 *
 * A contract is deliberately NOT an order. Nobody rings up on Tuesday to ask for
 * Wednesday's bread: the agreement already says what goes out, on which days, at
 * what price, until when. So this screen edits the AGREEMENT, and each day's
 * obligation is derived from it — which is what lets the Order Catalogue ask
 * "what do I owe on Wednesday" instead of the branch remembering.
 */
export default function ContractsPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');

  const [mode, setMode] = useState<'list' | 'edit'>('list');
  const [current, setCurrent] = useState<Contract | null>(null);
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: rows, loading, refetch } = useFetch<Contract[]>('/contracts');
  const { data: customers } = useFetch<Customer[]>('/customers');
  const { data: branches } = useFetch<Branch[]>('/branches');
  const { data: products } = useFetch<Product[]>(
    activeCompanyId ? `/products?forCompanyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );

  // ---- the form ----
  const [customerId, setCustomerId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<ContractStatus>('DRAFT');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);

  useUnsavedChangesGuard(() => dirty);
  const markDirty = () => setDirty(true);

  // What this company SELLS — the same test the order screens make.
  const sellable = useMemo(
    () =>
      (products ?? [])
        .filter((p) => p.canSell)
        .map((p) => ({ value: p.id, label: p.name })),
    [products],
  );
  const productById = useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p])),
    [products],
  );

  const openNew = () => {
    setCurrent(null);
    setCustomerId('');
    setBranchId('');
    setTitle('');
    setStartDate('');
    setEndDate('');
    setStatus('DRAFT');
    setNotes('');
    setLines([emptyLine()]);
    setDirty(false);
    setMode('edit');
  };

  const openRow = async (row: Contract) => {
    try {
      const full = await api.get<Contract>(`/contracts/${row.id}`);
      setCurrent(full);
      setCustomerId(String(full.customerId));
      setBranchId(full.branchId != null ? String(full.branchId) : '');
      setTitle(full.title ?? '');
      setStartDate(full.startDate);
      setEndDate(full.endDate);
      setStatus(full.status);
      setNotes(full.notes ?? '');
      setLines(
        full.lines.map((l) => ({
          productId: String(l.productId),
          quantity: String(l.quantity),
          rate: String(l.rate),
          supSun: l.supSun,
          supMon: l.supMon,
          supTue: l.supTue,
          supWed: l.supWed,
          supThu: l.supThu,
          supFri: l.supFri,
          supSat: l.supSat,
        })),
      );
      setDirty(false);
      setMode('edit');
    } catch {
      toast.error('Failed to open the contract.');
    }
  };

  const backToList = () => {
    setMode('list');
    setCurrent(null);
    setDirty(false);
    refetch();
  };

  const requestBack = async () => {
    if (dirty) {
      const ok = await confirm({
        title: 'Discard changes?',
        message: 'You have unsaved changes. Leave without saving?',
        confirmText: 'Yes',
        cancelText: 'No',
        danger: true,
        defaultCancel: true,
      });
      if (!ok) return;
    }
    backToList();
  };

  const setLine = (i: number, patch: Partial<DraftLine>) => {
    markDirty();
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const save = async () => {
    if (!customerId) return toast.error('Choose the customer.');
    if (!startDate || !endDate) return toast.error('Give the contract a period.');
    const clean = lines.filter((l) => l.productId);
    if (!clean.length) return toast.error('Add at least one product.');

    const payload = {
      customerId: Number(customerId),
      branchId: branchId ? Number(branchId) : null,
      title: title.trim() || undefined,
      startDate,
      endDate,
      status,
      notes: notes.trim() || undefined,
      lines: clean.map((l) => ({
        productId: Number(l.productId),
        quantity: Number(l.quantity) || 0,
        unitId: productById.get(Number(l.productId))!.unitId,
        rate: Number(l.rate) || 0,
        ...Object.fromEntries(DAYS.map((d) => [d.key, l[d.key]])),
      })),
    };

    setSaving(true);
    try {
      if (current) {
        await api.patch(`/contracts/${current.id}`, payload);
        toast.success('Contract saved.');
      } else {
        const made = await api.post<Contract>('/contracts', payload);
        toast.success(`Contract ${made.contractNo} created.`);
      }
      setDirty(false);
      backToList();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const del = async (row: Contract) => {
    const ok = await confirm({
      title: 'Delete contract',
      message: `Delete draft ${row.contractNo}? This cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/contracts/${row.id}`);
      toast.success('Contract deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<Contract>[] = [
    { key: 'contractNo', header: 'Contract', accessor: (r) => r.contractNo },
    {
      key: 'customer',
      header: 'Customer',
      accessor: (r) => r.customerName ?? '',
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.customerName ?? '—'}</p>
          {r.title && (
            <p className="truncate text-xs text-slate-400">{r.title}</p>
          )}
        </div>
      ),
    },
    {
      key: 'period',
      header: 'Period',
      sortAccessor: (r) => r.startDate,
      render: (r) => (
        <span className="whitespace-nowrap text-sm">
          {formatDayMonthYear(r.startDate)} — {formatDayMonthYear(r.endDate)}
        </span>
      ),
    },
    {
      key: 'products',
      header: 'Products',
      sortAccessor: (r) => r.lines.length,
      render: (r) => `${r.lines.length}`,
      className: 'text-right',
    },
    {
      key: 'days',
      header: 'Supply days',
      render: (r) => {
        // The union across every line — a contract's shape at a glance, without
        // opening it. Lines differ, so this is "some product goes out that day".
        const on = DAYS.filter((d) => r.lines.some((l) => l[d.key]));
        if (!on.length) return <span className="text-slate-400">—</span>;
        return (
          <span className="text-xs text-slate-600 dark:text-slate-300">
            {on.map((d) => d.label).join(' ')}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (r) => r.status,
      render: (r) => <Badge color={statusColor(r.status)}>{r.status}</Badge>,
    },
  ];

  if (mode === 'edit') {
    return (
      <div className="p-6">
        <PageHeader
          title={current ? `Contract ${current.contractNo}` : 'New contract'}
          description="What goes out, on which days, at what price, until when"
          icon={<FileSignature className="h-5 w-5" />}
          actions={
            <>
              <button className="btn-secondary" onClick={requestBack}>
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        />

        <div className="card p-6">
          <FormSection>The agreement</FormSection>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label="Customer"
              required
              value={customerId}
              onChange={(e) => {
                markDirty();
                setCustomerId(e.target.value);
              }}
              placeholder="Select a customer"
              options={(customers ?? []).map((c) => ({
                value: c.id,
                label: `${c.name} (${c.code})`,
              }))}
            />
            <Input
              label="Title"
              placeholder="Little Flower School, 2026-27"
              value={title}
              onChange={(e) => {
                markDirty();
                setTitle(e.target.value);
              }}
            />
            <Select
              label="Supplying branch"
              value={branchId}
              onChange={(e) => {
                markDirty();
                setBranchId(e.target.value);
              }}
              placeholder="— Served centrally —"
              options={(branches ?? [])
                .filter((b) => b.companyId === activeCompanyId)
                .map((b) => ({ value: b.id, label: b.name }))}
            />
            <DateInput
              label="Starts"
              required
              value={startDate}
              onChange={(iso) => {
                markDirty();
                setStartDate(iso);
              }}
            />
            <DateInput
              label="Ends"
              required
              value={endDate}
              onChange={(iso) => {
                markDirty();
                setEndDate(iso);
              }}
            />
            <Select
              label="Status"
              value={status}
              onChange={(e) => {
                markDirty();
                setStatus(e.target.value as ContractStatus);
              }}
              options={[
                { value: 'DRAFT', label: 'Draft' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'SUSPENDED', label: 'Suspended' },
                { value: 'EXPIRED', label: 'Expired' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ]}
            />
          </div>

          <FormSection>Products and supply days</FormSection>
          {/* Quantity is PER SUPPLY DAY, not per week — that is the only reading
              the daily order can use without dividing by a number nobody
              agreed, and the header says so rather than leaving it guessed. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                  <th className="py-2 pr-2">Product</th>
                  <th className="w-24 px-1 text-right">Qty / day</th>
                  <th className="w-12 px-1">Unit</th>
                  <th className="w-28 px-1 text-right">Contract price</th>
                  <th className="px-2 text-center">Supply days</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const p = l.productId
                    ? productById.get(Number(l.productId))
                    : undefined;
                  return (
                    <tr
                      key={i}
                      className="border-b border-slate-100 dark:border-slate-800/60"
                    >
                      <td className="py-1.5 pr-2">
                        <Select
                          value={l.productId}
                          onChange={(e) =>
                            setLine(i, { productId: e.target.value })
                          }
                          placeholder="Select product"
                          options={sellable}
                        />
                      </td>
                      <td className="px-1">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={l.quantity}
                          onChange={(e) =>
                            setLine(i, { quantity: e.target.value })
                          }
                          className="text-right tabular-nums"
                        />
                      </td>
                      <td className="px-1 text-xs text-slate-500">
                        {p ? (p.unit?.symbol ?? p.unit?.code ?? '') : ''}
                      </td>
                      <td className="px-1">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={l.rate}
                          onChange={(e) => setLine(i, { rate: e.target.value })}
                          className="text-right tabular-nums"
                        />
                      </td>
                      <td className="px-2">
                        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                          {DAYS.map((d) => (
                            <Checkbox
                              key={d.key}
                              label={d.label}
                              checked={l[d.key]}
                              onChange={(e) =>
                                setLine(i, { [d.key]: e.target.checked })
                              }
                            />
                          ))}
                        </div>
                      </td>
                      <td className="text-center">
                        <button
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                          onClick={() => {
                            markDirty();
                            setLines((ls) => ls.filter((_, x) => x !== i));
                          }}
                          aria-label="Remove line"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            className="btn-secondary mt-3 text-xs"
            onClick={() => {
              markDirty();
              setLines((ls) => [...ls, emptyLine()]);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add product
          </button>

          <Textarea
            label="Notes"
            wrapClassName="mt-6"
            value={notes}
            onChange={(e) => {
              markDirty();
              setNotes(e.target.value);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="Contracts"
        description="Standing supply agreements with institutional and contract customers"
        icon={<FileSignature className="h-5 w-5" />}
        actions={
          canAdd ? (
            <button className="btn-primary" onClick={openNew}>
              <Plus className="h-4 w-4" /> New contract
            </button>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        rows={rows ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Contract, customer or title…"
        onView={openRow}
        onEdit={canEdit ? openRow : undefined}
        onDelete={canDelete ? del : undefined}
        canView
        canEdit={canEdit}
        canDelete={canDelete}
        emptyMessage="No supply contracts yet"
      />
    </div>
  );
}
