'use client';

import { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer, CloseFooter } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import type {
  Company,
  Product,
  Unit,
  PurchaseOrder,
  PurchaseOrderStatus,
} from '@/lib/types';

const statusColor = (s: PurchaseOrderStatus) =>
  s === 'APPROVED' ? 'green' : s === 'REJECTED' ? 'red' : s === 'CANCELLED' ? 'slate' : 'amber';

const fmtDelivery = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString() : '-';

export default function SalesOrdersPage() {
  const { data, loading, refetch } = useFetch<PurchaseOrder[]>(
    '/purchase-orders?scope=incoming',
  );
  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: products } = useFetch<Product[]>('/products');
  const { data: units } = useFetch<Unit[]>('/units');

  const companyName = (id: number) =>
    (companies ?? []).find((c) => c.id === id)?.name ?? `#${id}`;
  const productName = (id: number) =>
    (products ?? []).find((p) => p.id === id)?.name ?? `#${id}`;
  const unitLabel = (id: number) => {
    const u = (units ?? []).find((x) => x.id === id);
    return u?.symbol ?? u?.code ?? '';
  };

  const [view, setView] = useState<PurchaseOrder | null>(null);

  const columns: Column<PurchaseOrder>[] = [
    { key: 'orderNo', header: 'Order No', accessor: (r) => r.orderNo },
    {
      key: 'from',
      header: 'From (Requester)',
      accessor: (r) => companyName(r.orderingCompanyId),
    },
    {
      key: 'items',
      header: 'Items',
      accessor: (r) => r.lines.length,
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    {
      key: 'qty',
      header: 'Total Qty',
      accessor: (r) =>
        r.lines.reduce((s, l) => s + l.quantity, 0).toLocaleString(),
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    {
      key: 'delivery',
      header: 'Delivery',
      accessor: (r) => fmtDelivery(r.deliveryAt),
      className: 'text-center',
      headerClassName: 'text-center',
    },
    {
      key: 'date',
      header: 'Received',
      accessor: (r) => new Date(r.createdAt).toLocaleDateString(),
      className: 'text-center',
      headerClassName: 'text-center',
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge color={statusColor(r.status)}>{r.status}</Badge>,
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <PageHeader
        title="Sales Orders"
        description="Inter-company purchase orders received — review and convert to sales orders"
        icon={<ClipboardList className="h-5 w-5" />}
      />
      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search orders..."
        onView={setView}
        canView
        emptyMessage="No incoming orders"
      />

      <Drawer
        open={!!view}
        onClose={() => setView(null)}
        title={view ? `Order ${view.orderNo}` : ''}
        subtitle={view ? `From ${companyName(view.orderingCompanyId)}` : ''}
        icon={<ClipboardList className="h-5 w-5" />}
        footer={<CloseFooter onClose={() => setView(null)} />}
      >
        {view && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Info label="Order No" value={view.orderNo} />
              <Info label="Status" value={view.status} />
              <Info
                label="Requester"
                value={companyName(view.orderingCompanyId)}
              />
              <Info
                label="Received"
                value={new Date(view.createdAt).toLocaleString()}
              />
              <Info label="Delivery" value={fmtDelivery(view.deliveryAt)} />
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                  <th className="py-2 pr-2">Product</th>
                  <th className="w-24 py-2 text-right">Qty</th>
                  <th className="w-16 py-2 px-1">Unit</th>
                </tr>
              </thead>
              <tbody>
                {view.lines.map((l) => (
                  <tr
                    key={l.id}
                    className="border-b border-slate-100 dark:border-slate-800/60"
                  >
                    <td className="py-2 pr-2 font-medium text-slate-800 dark:text-slate-100">
                      {productName(l.productId)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {l.quantity.toLocaleString()}
                    </td>
                    <td className="py-2 px-1 text-slate-500">
                      {unitLabel(l.unitId)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {view.notes && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Notes: {view.notes}
              </p>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="label !mb-0.5 block">{label}</span>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200">
        {value}
      </div>
    </div>
  );
}
