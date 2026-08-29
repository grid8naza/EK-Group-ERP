'use client';

import { useEffect, useMemo, useState } from 'react';
import { Handshake, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import {
  Drawer,
  DrawerFooter,
  CloseFooter,
  type SaveMode,
} from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Input, Checkbox, Select, Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { CoaAccount, Customer } from '@/lib/types';

const ROUTE = '/accounts/customers';

const empty = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  gstNumber: '',
  state: '',
  address: '',
  creditDays: '',
  creditLimit: '',
  controlAccountId: '',
  isActive: true,
};

export default function CustomersPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Customer[]>('/customers');
  // The receivable control accounts this company posts to — the mirror of the
  // supplier master's main ledger, read the same way.
  const { data: accounts } = useFetch<CoaAccount[]>('/coa/accounts');
  const mainLedgers = useMemo(
    () =>
      (accounts ?? [])
        .filter(
          (a) =>
            a.isControl &&
            a.controlParty === 'CUSTOMER' &&
            a.isActive &&
            a.adopted &&
            a.allowPosting !== false,
        )
        .map((a) => ({
          value: String(a.id),
          label: `${a.code} · ${a.localName ?? a.name}`,
        })),
    [accounts],
  );
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<Customer>({
      endpoint: '/customers',
      route: ROUTE,
      noun: 'customer',
      nameOf: (s) => s.name,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (s: Customer) => ({
    name: s.name,
    contactPerson: s.contactPerson ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    gstNumber: s.gstNumber ?? '',
    state: s.state ?? '',
    address: s.address ?? '',
    creditDays: s.creditDays == null ? '' : String(s.creditDays),
    creditLimit: s.creditLimit == null ? '' : String(s.creditLimit),
    controlAccountId:
      s.controlAccountId == null ? '' : String(s.controlAccountId),
    isActive: s.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };
  const openEdit = (s: Customer) => {
    setEditing(s);
    setView(false);
    setForm(formFrom(s));
    setOpen(true);
  };
  const openView = (s: Customer) => {
    setEditing(s);
    setView(true);
    setForm(formFrom(s));
    setOpen(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'a' && canAdd && !open) {
        e.preventDefault();
        openAdd();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAdd, open]);

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.name.trim()) {
      toast.error('Customer name is required.');
      return;
    }
    // Every sub-ledger belongs to one main ledger — a customer under no control
    // account is a balance that is part of no total.
    if (!form.controlAccountId) {
      toast.error('Choose the main ledger this customer is kept under.');
      return;
    }
    const payload = {
      name: form.name.trim(),
      contactPerson: form.contactPerson.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      gstNumber: form.gstNumber.trim() || null,
      state: form.state.trim() || null,
      address: form.address.trim() || null,
      // Blank means "no term agreed", which is not the same as zero days.
      creditDays: form.creditDays === '' ? null : Number(form.creditDays),
      creditLimit: form.creditLimit === '' ? null : Number(form.creditLimit),
      controlAccountId: Number(form.controlAccountId),
      isActive: form.isActive,
    };
    setSaving(true);
    try {
      let saved: Customer;
      if (editing) {
        saved = await api.patch<Customer>(`/customers/${editing.id}`, payload);
        toast.success('Customer updated.');
      } else {
        saved = await api.post<Customer>('/customers', payload);
        toast.success('Customer created.');
      }
      await refetch();
      if (mode === 'saveNew') {
        setEditing(null);
        setForm({ ...empty });
      } else if (mode === 'save') {
        setEditing(saved);
        setForm(formFrom(saved));
      } else {
        closeDrawer();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: Customer) => {
    const ok = await confirm({
      title: 'Delete customer',
      message: `Delete "${s.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/customers/${s.id}`);
      toast.success('Customer deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<Customer>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    {
      key: 'name',
      header: 'Customer',
      sortable: true,
      sortAccessor: (r) => r.name,
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    {
      key: 'contactPerson',
      header: 'Contact',
      accessor: (r) => r.contactPerson ?? '—',
    },
    { key: 'phone', header: 'Phone', accessor: (r) => r.phone ?? '—' },
    { key: 'gstNumber', header: 'GSTIN', accessor: (r) => r.gstNumber ?? '—' },
    { key: 'state', header: 'State', accessor: (r) => r.state ?? '—' },
    {
      key: 'controlAccount',
      header: 'Main ledger',
      accessor: (r) =>
        r.controlAccount
          ? `${r.controlAccount.code} ${r.controlAccount.name}`
          : '',
      render: (r) =>
        r.controlAccount ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {r.controlAccount.code} · {r.controlAccount.name}
          </span>
        ) : (
          <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
        ),
    },
    {
      key: 'creditDays',
      header: 'Credit',
      accessor: (r) => (r.creditDays == null ? '—' : `${r.creditDays} days`),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (r) => (
        <Badge color={r.isActive ? 'green' : 'slate'}>
          {r.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  const title = view
    ? 'View Customer'
    : editing
      ? 'Edit Customer'
      : 'New Customer';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Customer Master"
        description="Who the company sells to — details the Sundry Debtors control account, bill by bill"
        icon={<Handshake className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Add New
              <span className="ml-1 hidden text-[10px] opacity-70 sm:inline">
                Alt+A
              </span>
            </button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search customers..."
        onView={openView}
        onEdit={(r) => guardEdit(r, () => openEdit(r))}
        onDelete={(r) => guardDelete(r, () => remove(r))}
        canView={canView}
        canEdit={canEdit}
        canDelete={canDelete}
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No customers yet"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Customer"
        icon={<Handshake className="h-5 w-5" />}
        footer={
          view ? (
            <CloseFooter onClose={closeDrawer} />
          ) : (
            <DrawerFooter
              onCancel={closeDrawer}
              onSave={save}
              saving={saving}
              dataEntry
            />
          )
        }
      >
        <ReadOnlyFieldset readOnly={view}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {editing && <Input label="Code" value={editing.code} disabled />}
            <Input
              label="Customer name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Malabar Supermarkets"
              wrapClassName={editing ? undefined : 'sm:col-span-2'}
            />
            <Input
              label="Contact person"
              value={form.contactPerson}
              onChange={(e) =>
                setForm({ ...form, contactPerson: e.target.value })
              }
            />
            <Input
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              label="GSTIN"
              value={form.gstNumber}
              onChange={(e) => setForm({ ...form, gstNumber: e.target.value })}
            />
            <Input
              label="State"
              placeholder="Kerala"
              title="Where they are, for GST. With our own state it decides whether a bill carries CGST + SGST or IGST. Filled in from the GSTIN when one is given."
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            />
            {/* Which total this customer's balance is part of. Only the
                receivable control accounts are offered — an ordinary account has
                no sub-ledger to join. */}
            <div className="sm:col-span-2">
              <Select
                label="Main ledger"
                required
                value={form.controlAccountId}
                onChange={(e) =>
                  setForm({ ...form, controlAccountId: e.target.value })
                }
                options={mainLedgers}
                placeholder={
                  mainLedgers.length
                    ? 'Select a receivable ledger'
                    : 'No receivable control account in use here'
                }
                disabled={!mainLedgers.length}
              />
              <p className="mt-1 text-xs text-slate-400">
                The control account this customer is kept under. A voucher line
                naming that account offers only the customers kept under it, so
                every customer belongs to exactly one.
              </p>
            </div>
            <Textarea
              label="Address"
              wrapClassName="sm:col-span-2"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            {/* What the ageing report counts against. Left blank, a bill is due
                the day it is raised and no ceiling is checked. */}
            <Input
              label="Credit period (days)"
              type="number"
              min="0"
              value={form.creditDays}
              onChange={(e) => setForm({ ...form, creditDays: e.target.value })}
              placeholder="No agreed term"
            />
            <Input
              label="Credit limit"
              type="number"
              min="0"
              step="0.01"
              value={form.creditLimit}
              onChange={(e) =>
                setForm({ ...form, creditLimit: e.target.value })
              }
              placeholder="No ceiling"
            />
            <div className="sm:col-span-2">
              <Checkbox
                label="Active"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
              />
            </div>
          </div>
        </ReadOnlyFieldset>
      </Drawer>
    </div>
  );
}
