'use client';

import { useMemo, useState } from 'react';
import { PackagePlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, CloseFooter } from '@/components/ui/Drawer';
import type { ProductionReceipt, Unit } from '@/lib/types';
import { formatDateTime, formatDayMonthYear } from '@/lib/utils';

const ROUTE = '/production/receipts';

const fmt = (iso?: string | null) => (iso ? formatDateTime(iso) : '—');
const fmtDate = (iso?: string | null) => (iso ? formatDayMonthYear(iso) : '—');

export default function ProductionReceiptsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, refetch } = useFetch<ProductionReceipt[]>(
    '/production-receipts',
  );
  const { data: units } = useFetch<Unit[]>('/units');
  const { canLock, canUnlock, toggleLock, bulkLock } =
    useLock<ProductionReceipt>({
      endpoint: '/production-receipts',
      route: ROUTE,
      noun: 'production receipt',
      nameOf: (r) => r.receiptNo,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ProductionReceipt | null>(null);

  const canView = can(ROUTE, 'view');

  const unitById = useMemo(
    () => new Map((units ?? []).map((u) => [u.id, u])),
    [units],
  );
  const unitLabel = (id: number) => {
    const u = unitById.get(id);
    return u?.symbol ?? u?.code ?? '';
  };

  const openView = async (row: ProductionReceipt) => {
    try {
      const full = await api.get<ProductionReceipt>(
        `/production-receipts/${row.id}`,
      );
      setCurrent(full);
      setOpen(true);
    } catch {
      toast.error('Failed to open the receipt.');
    }
  };

  const columns: Column<ProductionReceipt>[] = [
    { key: 'receiptNo', header: 'Receipt', accessor: (r) => r.receiptNo },
    {
      key: 'workOrder',
      header: 'Work Order',
      accessor: (r) => r.workOrderNo ?? '—',
    },
    { key: 'store', header: 'Store', accessor: (r) => r.storeName ?? '—' },
    {
      key: 'products',
      header: 'Products',
      accessor: (r) => String(r.lines.length),
    },
    {
      key: 'date',
      header: 'Produced',
      accessor: (r) => fmtDate(r.receiptDate),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Production Receipt"
        description="Finished goods banked into stock from work orders — one batch per product"
        icon={<PackagePlus className="h-5 w-5" />}
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search receipts..."
        onView={openView}
        canView={canView}
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No production receipts yet"
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={current ? current.receiptNo : 'Production Receipt'}
        subtitle="Finished goods in"
        icon={<PackagePlus className="h-5 w-5" />}
        footer={<CloseFooter onClose={() => setOpen(false)} />}
      >
        {current && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Field label="Work order" value={current.workOrderNo ?? '—'} />
              <Field label="Store" value={current.storeName ?? '—'} />
              <Field label="Produced" value={fmt(current.receiptDate)} />
              <Field label="Created" value={fmt(current.createdAt)} />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                    <th className="py-2 pr-2">Product</th>
                    <th className="w-24 py-2 text-right">Qty</th>
                    <th className="w-12 py-2 pl-2">Unit</th>
                    <th className="py-2 pl-2">Batch</th>
                    <th className="w-28 py-2 pl-2">Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {current.lines.map((l) => (
                    <tr
                      key={l.id}
                      className="border-b border-slate-100 dark:border-slate-800/60"
                    >
                      <td className="py-1.5 pr-2 font-medium text-slate-800 dark:text-slate-100">
                        {l.productName}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {l.quantity.toLocaleString()}
                      </td>
                      <td className="py-1.5 pl-2 text-slate-500">
                        {unitLabel(l.unitId)}
                      </td>
                      <td className="py-1.5 pl-2 font-mono text-xs text-slate-600 dark:text-slate-300">
                        {l.batchNo ?? '—'}
                      </td>
                      <td className="py-1.5 pl-2 text-slate-500">
                        {fmtDate(l.expiryDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-slate-700 dark:text-slate-300">{value}</p>
    </div>
  );
}
