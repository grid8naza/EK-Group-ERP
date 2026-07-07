'use client';

import { useEffect, useMemo, useState } from 'react';
import { ShoppingCart, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Company, Product, SalesOrder, SalesOrderStatus } from '@/lib/types';

const ROUTE = '/crm/place-order';

type DraftLine = { productId: string; quantity: string };

const statusColor = (s: SalesOrderStatus) =>
  s === 'APPROVED' ? 'green' : s === 'REJECTED' ? 'red' : s === 'CANCELLED' ? 'slate' : 'amber';

export default function PlaceOrderPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: placed, loading, refetch } = useFetch<SalesOrder[]>(
    '/sales-orders?scope=placed',
  );

  const canAdd = can(ROUTE, 'add');

  const suppliers = useMemo(
    () => (companies ?? []).filter((c) => c.id !== activeCompanyId),
    [companies, activeCompanyId],
  );
  const companyName = (id: number) =>
    (companies ?? []).find((c) => c.id === id)?.name ?? `#${id}`;

  const [supplierId, setSupplierId] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Products belong to the SUPPLIER; fetch that company's catalogue.
  useEffect(() => {
    if (!supplierId) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    api
      .get<Product[]>(`/products?forCompanyId=${supplierId}`)
      .then((p) => !cancelled && setProducts(p ?? []))
      .catch(() => !cancelled && setProducts([]));
    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const addLine = () => setLines((ls) => [...ls, { productId: '', quantity: '' }]);
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) =>
    setLines((ls) => ls.filter((_, idx) => idx !== i));

  const reset = () => {
    setSupplierId('');
    setLines([]);
    setNotes('');
  };

  const submit = async () => {
    if (!supplierId) {
      toast.error('Select a supplier company.');
      return;
    }
    const clean = lines.filter((l) => l.productId && Number(l.quantity) > 0);
    if (clean.length === 0) {
      toast.error('Add at least one product line with a quantity.');
      return;
    }
    const payload = {
      supplierCompanyId: Number(supplierId),
      notes: notes.trim() || undefined,
      lines: clean.map((l) => ({
        productId: Number(l.productId),
        quantity: Number(l.quantity),
        unitId: productById.get(Number(l.productId))!.unitId,
      })),
    };
    setSaving(true);
    try {
      await api.post('/sales-orders', payload);
      toast.success('Order placed.');
      reset();
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to place order.');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<SalesOrder>[] = [
    { key: 'orderNo', header: 'Order No', accessor: (r) => r.orderNo },
    { key: 'supplier', header: 'Supplier', accessor: (r) => companyName(r.companyId) },
    {
      key: 'items',
      header: 'Items',
      accessor: (r) => r.lines.length,
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    {
      key: 'date',
      header: 'Placed',
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
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 overflow-y-auto pb-4">
      <PageHeader
        title="Place Order"
        description="Place a sales order on a supplier company"
        icon={<ShoppingCart className="h-5 w-5" />}
      />

      {canAdd && (
        <div className="card border-[#e7ddcb] bg-[#fbf9f4] p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Supplier"
              required
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setLines([]);
              }}
              placeholder="Select a supplier company"
              options={suppliers.map((c) => ({
                value: c.id,
                label: `${c.name} (${c.code})`,
              }))}
            />
          </div>

          {supplierId && (
            <>
              <div className="mt-4 flex items-center justify-between">
                <span className="label !mb-0">Products</span>
                <button className="btn-secondary text-xs" onClick={addLine}>
                  <Plus className="h-3.5 w-3.5" /> Add line
                </button>
              </div>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                    <th className="py-2 pr-2">Product</th>
                    <th className="w-32 py-2 px-1 text-right">Quantity</th>
                    <th className="w-16 py-2 px-1">Unit</th>
                    <th className="w-12 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="py-4 text-center text-xs text-slate-400"
                      >
                        No lines yet — click “Add line”.
                      </td>
                    </tr>
                  ) : (
                    lines.map((l, i) => {
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
                              options={products.map((pr) => ({
                                value: pr.id,
                                label: pr.name,
                              }))}
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
                          <td className="px-1 text-slate-500">
                            {p ? (p.unit?.symbol ?? p.unit?.code ?? '') : ''}
                          </td>
                          <td className="text-center">
                            <button
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                              onClick={() => removeLine(i)}
                              aria-label="Remove line"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>

              <Textarea
                label="Notes"
                wrapClassName="mt-4"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />

              <div className="mt-4 flex justify-end gap-2">
                <button className="btn-secondary" onClick={reset}>
                  Clear
                </button>
                <button
                  className="btn-primary"
                  onClick={submit}
                  disabled={saving}
                >
                  Place Order
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={placed ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight={false}
        onRefresh={refetch}
        searchPlaceholder="Search orders..."
        emptyMessage="No orders placed yet"
      />
    </div>
  );
}
