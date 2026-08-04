'use client';

import { useMemo, useState } from 'react';
import { FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { useConfirm } from '@/providers/ConfirmProvider';
import { GroupDrawer } from './GroupDrawer';
import type { AccountGroup, AccountNature } from '@/lib/types';

const ROUTE = '/accounts/account-groups';

/** The five blocks the five-digit code sorts into (Annexure D.3). */
const BLOCKS: { digit: string; label: string }[] = [
  { digit: '1', label: '1 · Assets' },
  { digit: '2', label: '2 · Liabilities' },
  { digit: '3', label: '3 · Equity and Reserves' },
  { digit: '4', label: '4 · Income' },
  { digit: '5', label: '5 · Purchases and Direct Expenses' },
  { digit: '6', label: '6 · Indirect and Operating Expenses' },
  { digit: '7', label: '7 · Other Income' },
  { digit: '8', label: '8 · Finance Cost, Tax and Non-operating' },
  { digit: '9', label: '9 · Control, Clearing and Suspense' },
];

const NATURE_TONE: Record<AccountNature, string> = {
  ASSET: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  LIABILITY: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  EQUITY: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  INCOME: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  EXPENSE: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
};

/**
 * The headings the statements roll up through.
 *
 * A group is never posted to — that is what its code ending in 00 signifies —
 * so this screen is about SHAPE: which block a heading sits in, what it rolls
 * up into, and which statement its balances land in. The accounts themselves
 * are maintained next door under Account Ledgers.
 */
export default function AccountGroupsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: groups, loading, refetch } = useFetch<AccountGroup[]>('/coa/groups');

  const [search, setSearch] = useState('');
  const [block, setBlock] = useState('');
  const [level, setLevel] = useState(''); // '' | 'top' | 'child'
  const [editing, setEditing] = useState<AccountGroup | null>(null);
  const [adding, setAdding] = useState(false);

  const canEdit = can(ROUTE, 'edit');
  const canAdd = can(ROUTE, 'add');
  const canDelete = can(ROUTE, 'delete');

  const all = useMemo(() => groups ?? [], [groups]);
  const byId = useMemo(
    () => new Map(all.map((g) => [g.id, g])),
    [all],
  );

  const rows = useMemo(() => {
    let out = all;
    if (block) out = out.filter((g) => g.code.startsWith(block));
    if (level === 'top') out = out.filter((g) => !g.parentGroupId);
    else if (level === 'child') out = out.filter((g) => !!g.parentGroupId);
    return out;
  }, [all, block, level]);

  /**
   * Anything the annexure shipped is deactivated rather than deleted, and the
   * server refuses it regardless of what the UI offers — the master is the
   * signed-off baseline and consolidation depends on its codes staying put.
   */
  const remove = async (g: AccountGroup) => {
    const ok = await confirm({
      title: 'Delete group',
      message:
        `Delete ${g.code} ${g.name}? It was added here rather than shipped ` +
        `with the annexure, so it can go.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      danger: true,
      defaultCancel: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/coa/groups/${g.id}`);
      toast.success('Group deleted.');
      await refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<AccountGroup>[] = [
    {
      key: 'code',
      header: 'Code',
      className: 'tabular-nums font-medium',
      accessor: (g) => g.code,
    },
    {
      key: 'name',
      header: 'Group',
      accessor: (g) => `${g.name} ${g.tallyGroup ?? ''}`,
      render: (g) => {
        const parent = g.parentGroupId ? byId.get(g.parentGroupId) : null;
        return (
          <div>
            <div
              className={cn(
                'text-slate-800 dark:text-slate-100',
                // A top-level heading starts a block of its own; indenting the
                // children is what makes the hierarchy readable at a glance.
                parent ? 'pl-4 font-normal' : 'font-semibold',
              )}
            >
              {g.name}
            </div>
            <div className={cn('text-xs text-slate-400', parent && 'pl-4')}>
              {parent ? `under ${parent.code} · ${parent.name}` : 'Top-level block'}
            </div>
          </div>
        );
      },
    },
    {
      key: 'nature',
      header: 'Nature',
      accessor: (g) => g.nature,
      render: (g) => (
        <span
          className={cn('rounded px-2 py-0.5 text-xs font-medium', NATURE_TONE[g.nature])}
        >
          {g.nature}
        </span>
      ),
    },
    {
      key: 'statement',
      header: 'Statement',
      accessor: (g) => g.statement,
      render: (g) => (
        <span className="text-xs text-slate-500">
          {g.statement === 'BS' ? 'Balance Sheet' : 'Profit & Loss'} · {g.normalSide}
        </span>
      ),
    },
    {
      key: 'tallyGroup',
      header: 'Tally Group',
      accessor: (g) => g.tallyGroup ?? '',
      render: (g) => (
        <span className="text-xs text-slate-400">{g.tallyGroup ?? '—'}</span>
      ),
    },
    {
      key: 'holds',
      header: 'Holds',
      headerClassName: 'text-center',
      className: 'text-center',
      sortAccessor: (g) => (g.accountCount ?? 0) + (g.childCount ?? 0),
      render: (g) => (
        <span className="text-xs text-slate-500">
          {g.childCount ? `${g.childCount} sub-group${g.childCount === 1 ? '' : 's'}` : ''}
          {g.childCount && g.accountCount ? ' · ' : ''}
          {g.accountCount ? `${g.accountCount} account${g.accountCount === 1 ? '' : 's'}` : ''}
          {!g.childCount && !g.accountCount ? 'Empty' : ''}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      headerClassName: 'text-center',
      className: 'text-center',
      sortAccessor: (g) => (g.isActive ? 1 : 0),
      render: (g) =>
        g.isActive ? (
          <Badge color="green">Active</Badge>
        ) : (
          <Badge color="slate">Inactive</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      sortable: false,
      className: 'w-20',
      render: (g) => (
        <div className="flex items-center gap-0.5">
          {canEdit && (
            <button
              title="Edit name, Tally group and status"
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(g);
              }}
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {/* Shipped groups have no delete at all, rather than one that always
              fails. */}
          {canDelete && !g.isSystem && (
            <button
              title="Delete this group"
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
              onClick={(e) => {
                e.stopPropagation();
                void remove(g);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const topLevel = all.filter((g) => !g.parentGroupId).length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Account Groups"
        description="The headings the Chart of Accounts rolls up through. A group is never posted to — the accounts under it are."
        icon={<FolderTree className="h-5 w-5" />}
        actions={
          canAdd ? (
            <button className="btn-primary" onClick={() => setAdding(true)}>
              <Plus className="mr-1 inline h-4 w-4" />
              New Group
            </button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-start gap-2 text-sm text-slate-500 dark:text-slate-400">
        <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
          {all.length} groups
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
          {topLevel} top-level blocks
        </span>
        <p className="basis-full pt-1 text-xs">
          A code ending in 00 is a heading; a child shares its parent&apos;s first
          two digits and inherits its nature, so a balance can never land in a
          different statement from the group it rolls up into.
        </p>
      </div>

      <div className="min-h-0 flex-1">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(g) => g.id}
          loading={loading}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search code, group or Tally group…"
          onRefresh={refetch}
          emptyMessage="No groups match these filters."
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={block}
                onChange={(e) => setBlock(e.target.value)}
                options={BLOCKS.map((b) => ({ value: b.digit, label: b.label }))}
                placeholder="All blocks"
                className="w-56"
              />
              <Select
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                options={[
                  { value: 'top', label: 'Top-level only' },
                  { value: 'child', label: 'Sub-groups only' },
                ]}
                placeholder="Any level"
                className="w-44"
              />
            </div>
          }
        />
      </div>

      <GroupDrawer
        open={adding || !!editing}
        group={editing}
        groups={all}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSaved={refetch}
      />
    </div>
  );
}
