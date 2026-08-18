'use client';

import { useMemo, useState } from 'react';
import { Users, Plus, UserCheck, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useLock } from '@/lib/useLock';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Badge } from '@/components/ui/Badge';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import {
  Checkbox,
  Input,
  MultiSelect,
  Select,
  Textarea,
} from '@/components/ui/Field';
import type { Branch, Employee, HrTeam } from '@/lib/types';

const ROUTE = '/hr/teams';

const empty = {
  name: '',
  branchId: '',
  leaderEmployeeId: '',
  memberIds: [] as number[],
  remarks: '',
  isActive: true,
};

/**
 * Team Master (SRS §8.9) — who works together, and who answers for them.
 *
 * The point is answerability: each team's attendance is its own daily sheet,
 * marked and submitted by its LEADER, so a branch of ninety is marked by six
 * people who each know the dozen in front of them rather than by one person
 * guessing.
 *
 * A team belongs to one branch, and a person to at most one team — two leaders
 * marking the same person on the same day is exactly the argument a sheet
 * cannot settle. Anybody in no team is marked on the branch's own sheet.
 */
export default function TeamsPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();

  const { data, loading, refetch } = useFetch<HrTeam[]>(
    '/hr-teams?branchId=all',
  );
  const { data: branches } = useFetch<Branch[]>(
    activeCompanyId ? `/branches?companyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );
  const { data: employees } = useFetch<Employee[]>('/hr-employees');

  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<HrTeam>({
      endpoint: '/hr-teams',
      route: ROUTE,
      noun: 'team',
      nameOf: (t) => t.name,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HrTeam | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const branchName = (id: number | null) =>
    id === null
      ? 'The whole company'
      : ((branches ?? []).find((b) => b.id === id)?.name ?? `#${id}`);

  /**
   * Who may be put in this team: the people at its branch who are in no other
   * team — plus its own current members, who are obviously still eligible.
   *
   * Offered rather than validated afterwards: a picker that lists somebody
   * already in another team is a picker whose choice the server refuses.
   */
  const eligible = useMemo(() => {
    const branchId = form.branchId ? Number(form.branchId) : null;
    const takenElsewhere = new Set(
      (data ?? [])
        .filter((t) => t.id !== editing?.id)
        .flatMap((t) => t.memberIds),
    );
    return (employees ?? []).filter(
      (e) =>
        e.isActive &&
        (branchId === null || e.branchId === branchId) &&
        !takenElsewhere.has(e.id),
    );
  }, [employees, data, editing, form.branchId]);

  /** The leader is chosen from the same branch, member or not. */
  const leaderOptions = useMemo(() => {
    const branchId = form.branchId ? Number(form.branchId) : null;
    return (employees ?? [])
      .filter(
        (e) => e.isActive && (branchId === null || e.branchId === branchId),
      )
      .map((e) => ({ value: e.id, label: `${e.code} — ${e.name}` }));
  }, [employees, form.branchId]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...empty });
    setOpen(true);
  };

  const openEdit = (row: HrTeam) =>
    guardEdit(row, () => {
      setEditing(row);
      setForm({
        name: row.name,
        branchId: row.branchId ? String(row.branchId) : '',
        leaderEmployeeId: String(row.leaderEmployeeId),
        memberIds: row.memberIds,
        remarks: row.remarks ?? '',
        isActive: row.isActive,
      });
      setOpen(true);
    });

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('Give the team a name.');
      return;
    }
    if (!form.leaderEmployeeId) {
      toast.error('Who leads it? A team without a leader marks nothing.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        branchId: form.branchId ? Number(form.branchId) : null,
        leaderEmployeeId: Number(form.leaderEmployeeId),
        memberIds: form.memberIds,
        remarks: form.remarks.trim() || null,
        isActive: form.isActive,
      };
      if (editing) await api.patch(`/hr-teams/${editing.id}`, payload);
      else await api.post('/hr-teams', payload);
      toast.success(editing ? 'Team updated.' : 'Team created.');
      setOpen(false);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = (row: HrTeam) =>
    guardDelete(row, async () => {
      try {
        await api.delete(`/hr-teams/${row.id}`);
        toast.success('Team removed.');
        refetch();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Failed to remove.');
      }
    });

  const columns: Column<HrTeam>[] = [
    { key: 'name', header: 'Team', sortable: true, accessor: (r) => r.name },
    {
      key: 'leader',
      header: 'Team leader',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <UserCheck className="h-3.5 w-3.5 text-brand-600" />
          {r.leaderName}
        </span>
      ),
    },
    {
      key: 'branch',
      header: 'Branch',
      accessor: (r) => branchName(r.branchId),
    },
    {
      key: 'members',
      header: 'People',
      render: (r) =>
        r.memberIds.length ? (
          <span className="tabular-nums">{r.memberIds.length}</span>
        ) : (
          // An empty team marks an empty sheet — worth noticing, not hiding.
          <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" /> nobody yet
          </span>
        ),
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

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <PageHeader
        title="Team Master"
        description="Who works together, and who answers for their attendance"
        icon={<Users className="h-5 w-5" />}
        actions={
          can(ROUTE, 'add') && (
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              onClick={openNew}
            >
              <Plus className="h-4 w-4" /> Add a team
            </button>
          )
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        {!activeCompanyId ? (
          <p className="text-sm text-slate-400">Choose a company first.</p>
        ) : (
          <DataTable
            rows={data ?? []}
            columns={columns}
            loading={loading}
            rowKey={(r) => r.id}
            emptyMessage="No teams yet. Without them, a branch marks one sheet a day for everybody."
            onEdit={can(ROUTE, 'edit') ? openEdit : undefined}
            onDelete={can(ROUTE, 'delete') ? remove : undefined}
            renderLock={(r) => (
              <LockButton
                locked={r.isLocked}
                canLock={canLock}
                canUnlock={canUnlock}
                onToggle={() => toggleLock(r)}
              />
            )}
            bulkLock={bulkLock}
          />
        )}
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit team' : 'Add a team'}
        subtitle="Its leader marks its attendance, day by day"
        width="lg"
        footer={
          <DrawerFooter
            onCancel={() => setOpen(false)}
            onSave={save}
            saving={saving}
          />
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Team"
              required
              value={form.name}
              placeholder="Oven Team"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Select
              label="Branch"
              value={form.branchId}
              placeholder="The whole company"
              onChange={(e) =>
                // The branch decides who may be in it, so changing it clears a
                // membership that would no longer be allowed.
                setForm({
                  ...form,
                  branchId: e.target.value,
                  leaderEmployeeId: '',
                  memberIds: [],
                })
              }
              options={(branches ?? [])
                .filter((b) => b.isActive)
                .map((b) => ({ value: b.id, label: b.name }))}
            />
          </div>

          <Select
            label="Team leader"
            required
            value={form.leaderEmployeeId}
            placeholder="Who answers for this team"
            onChange={(e) =>
              setForm({ ...form, leaderEmployeeId: e.target.value })
            }
            options={leaderOptions}
          />
          <p className="-mt-2 text-xs text-slate-400">
            They mark this team&apos;s attendance every day, and submit it for
            verification. They need a login to do so — one is given on their own
            record, under User Access.
          </p>

          <MultiSelect
            label="People in the team"
            value={form.memberIds}
            placeholder="Choose the people this team marks"
            onChange={(v) => setForm({ ...form, memberIds: v.map(Number) })}
            options={eligible.map((e) => ({
              value: e.id,
              label: `${e.code} — ${e.name}`,
            }))}
          />
          <p className="-mt-2 text-xs text-slate-400">
            Only people at this branch who are in no other team are offered —
            somebody can be in one team at a time, so that exactly one leader
            answers for each day of their attendance. Anybody left in no team is
            marked on the branch&apos;s own sheet.
          </p>

          <Textarea
            label="Remarks"
            rows={2}
            value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.target.value })}
          />
          <Checkbox
            label="Active"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
        </div>
      </Drawer>
    </div>
  );
}
