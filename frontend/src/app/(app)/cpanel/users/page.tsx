'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users, Building2, Smartphone, Globe, Info } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, CloseFooter } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import { UserAccessPanel } from '@/components/cpanel/UserAccessPanel';
import type { AppUser } from '@/lib/types';

const ROUTE = '/cpanel/users';

/**
 * Users & Data Security — the REGISTER of who can sign in, and what they reach.
 *
 * Read-only by design. A login belongs to an employee, so it is set up where
 * that person's record is: HR → Employee Master → User Access. Leaving a second
 * way to create one here would mean accounts that answer to nobody on the staff
 * register, which is the thing the move was made to stop.
 *
 * Locking is still offered, because it still bites: a locked user cannot be
 * edited from the employee tab either (the User service checks it server-side).
 */
export default function UsersPage() {
  const { can } = useAuth();
  const toast = useToast();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const canView = can(ROUTE, 'view');

  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<AppUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = search.trim()
        ? `?search=${encodeURIComponent(search.trim())}`
        : '';
      const res = await api.get<AppUser[]>(`/users${q}`);
      setUsers(res ?? []);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        toast.error('Failed to load users.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const { canLock, canUnlock, toggleLock, bulkLock } = useLock<AppUser>({
    endpoint: '/users',
    route: ROUTE,
    noun: 'user',
    nameOf: (u) => u.name,
    reload: load,
  });

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const openView = (u: AppUser) => {
    setViewing(u);
    setOpen(true);
  };

  const columns: Column<AppUser>[] = [
    { key: 'userCode', header: 'Code', accessor: (r) => r.userCode },
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-100">
            {r.name}
          </p>
          <p className="text-xs text-slate-400">{r.username}</p>
        </div>
      ),
    },
    {
      key: 'employee',
      header: 'Employee',
      // Which staff record this login answers to. Blank on the super admin,
      // who is nobody's employee and never will be.
      render: (r) =>
        r.employee ? (
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {r.employee.name}
            </p>
            <p className="font-mono text-xs text-slate-400">
              {r.employee.code}
            </p>
          </div>
        ) : (
          <span className="text-xs text-slate-400">
            {r.isSuperAdmin ? 'System account' : 'None'}
          </span>
        ),
    },
    { key: 'email', header: 'Email', accessor: (r) => r.email },
    { key: 'mobile', header: 'Mobile', accessor: (r) => r.mobile },
    {
      key: 'companies',
      header: 'Companies',
      render: (r) => {
        const list = r.companies ?? [];
        if (list.length === 0)
          return <span className="text-xs text-slate-400">None</span>;
        return (
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-slate-400" />
            <span
              className="text-sm text-slate-600 dark:text-slate-300"
              title={list.map((c) => c.name).join(', ')}
            >
              {list.length === 1 ? list[0].name : `${list.length} companies`}
            </span>
          </div>
        );
      },
    },
    {
      key: 'securityType',
      header: 'Security',
      render: (r) => <Badge color="blue">{r.securityType}</Badge>,
    },
    {
      key: 'access',
      header: 'Access',
      render: (r) => {
        const channels: React.ReactNode[] = [];
        if (r.webEnabled)
          channels.push(
            <span
              key="w"
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              title="Web access"
            >
              <Globe className="h-3 w-3" /> Web
            </span>,
          );
        if (r.mobileEnabled)
          channels.push(
            <span
              key="m"
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              title="Mobile access"
            >
              <Smartphone className="h-3 w-3" /> Mobile
            </span>,
          );
        return channels.length ? (
          <div className="flex flex-wrap gap-1">{channels}</div>
        ) : (
          <span className="text-xs text-slate-400">None</span>
        );
      },
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
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Users & Data Security"
        description="Who can sign in, and what they reach — a register, not an editor"
        icon={<Users className="h-5 w-5" />}
      />

      {/* Where the editing went. Said once, at the top, rather than on each
          disabled button. */}
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-200">
        <Info className="mt-0.5 h-4 w-4 flex-none" />
        <p>
          Logins are set up on the person&apos;s own record — HR &rarr; Employee
          Master &rarr; <span className="font-semibold">User Access</span>. Only
          somebody on the employee register can be given one, which is what
          keeps every account attached to a person. Roles are defined in Cpanel
          &rarr;{' '}
          <span className="font-semibold">User Groups &amp; Privileges</span>.
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={users}
        rowKey={(r) => r.id}
        loading={loading}
        onRefresh={load}
        search={search}
        onSearchChange={setSearch}
        serverSearch
        searchPlaceholder="Search users..."
        onView={openView}
        canView={canView}
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            // The super admin account is permanently locked — never offer unlock.
            canUnlock={r.isSuperAdmin ? false : canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No users found"
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="View User"
        subtitle="User & data security"
        icon={<Users className="h-5 w-5" />}
        width="lg"
        footer={<CloseFooter onClose={() => setOpen(false)} />}
      >
        <UserAccessPanel user={viewing} employee={viewing?.employee} readOnly />
      </Drawer>
    </div>
  );
}
