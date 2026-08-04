'use client';

import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/Field';
import type { AccountGroup, CoaAccount } from '@/lib/types';

const PARTY_OPTIONS = [
  { value: 'SUPPLIER', label: 'Supplier' },
  { value: 'CUSTOMER', label: 'Customer' },
  { value: 'EMPLOYEE', label: 'Employee' },
  { value: 'COMPANY', label: 'Company' },
  { value: 'OTHER', label: 'Other' },
];
const SIDE_OPTIONS = [
  { value: 'DR', label: 'Debit' },
  { value: 'CR', label: 'Credit' },
];

type Form = {
  groupId: string;
  code: string;
  name: string;
  scope: 'GROUP' | 'PRIVATE';
  normalSide: string;
  isContra: boolean;
  isControl: boolean;
  controlParty: string;
  hasCostCenter: boolean;
  hasCostObject: boolean;
  isGstRelevant: boolean;
  isBankOrCash: boolean;
  isReconcilable: boolean;
  allowManualJe: boolean;
  notes: string;
  isActive: boolean;
};

const EMPTY: Form = {
  groupId: '',
  code: '',
  name: '',
  scope: 'GROUP',
  normalSide: '',
  isContra: false,
  isControl: false,
  controlParty: '',
  hasCostCenter: false,
  hasCostObject: false,
  isGstRelevant: false,
  isBankOrCash: false,
  isReconcilable: false,
  allowManualJe: true,
  notes: '',
  isActive: true,
};

/**
 * Add or edit a ledger account.
 *
 * On an EXISTING account most of the form is read-only. Code, group, nature and
 * side decide which statement a balance lands in and how it rolls up, so
 * changing one after the fact would move money between statements silently —
 * the annexure treats them as structural and so does this.
 */
export function AccountDrawer({
  open,
  account,
  groups,
  companyName,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = creating. */
  account: CoaAccount | null;
  groups: AccountGroup[];
  companyName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const editing = !!account;

  useEffect(() => {
    if (!open) return;
    setForm(
      account
        ? {
            ...EMPTY,
            groupId: String(account.groupId),
            code: account.code,
            name: account.name,
            scope: account.isSystem ? 'GROUP' : 'GROUP',
            normalSide: account.normalSide,
            isContra: account.isContra,
            isControl: account.isControl,
            controlParty: account.controlParty ?? '',
            hasCostCenter: account.hasCostCenter,
            hasCostObject: account.hasCostObject,
            isGstRelevant: account.isGstRelevant,
            isBankOrCash: account.isBankOrCash,
            isReconcilable: account.isReconcilable,
            allowManualJe: account.allowManualJe,
            notes: account.notes ?? '',
            isActive: account.isActive,
          }
        : EMPTY,
    );
  }, [open, account]);

  const group = groups.find((g) => String(g.id) === form.groupId);

  /**
   * Choosing a group fixes the nature and side, and proposes the next free code
   * in that group's hundred — the annexure's numbering, offered rather than
   * imposed.
   */
  const onGroupChange = async (groupId: string) => {
    const g = groups.find((x) => String(x.id) === groupId);
    setForm((f) => ({ ...f, groupId, normalSide: g?.normalSide ?? '' }));
    if (!groupId) return;
    try {
      const { code } = await api.get<{ code: string | null }>(
        `/coa/groups/${groupId}/next-account-code`,
      );
      setForm((f) => (f.groupId === groupId ? { ...f, code: code ?? '' } : f));
    } catch {
      /* the field stays blank and the server assigns one */
    }
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error('Give the account a name.');
    if (!editing && !form.groupId) return toast.error('Choose a group.');
    if (form.isControl && !form.controlParty) {
      return toast.error('A control account must say which party ages it.');
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/coa/accounts/${account!.id}`, {
          name: form.name,
          notes: form.notes,
          hasCostCenter: form.hasCostCenter,
          hasCostObject: form.hasCostObject,
          allowManualJe: form.allowManualJe,
          isActive: form.isActive,
        });
      } else {
        await api.post('/coa/accounts', {
          groupId: Number(form.groupId),
          code: form.code.trim() || undefined,
          name: form.name,
          scope: form.scope,
          normalSide: form.normalSide || undefined,
          isContra: form.isContra,
          isControl: form.isControl,
          controlParty: form.isControl ? form.controlParty : undefined,
          hasCostCenter: form.hasCostCenter,
          hasCostObject: form.hasCostObject,
          isGstRelevant: form.isGstRelevant,
          isBankOrCash: form.isBankOrCash,
          isReconcilable: form.isReconcilable,
          allowManualJe: form.allowManualJe,
          notes: form.notes || undefined,
        });
      }
      toast.success(editing ? 'Account saved.' : 'Account added.');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save the account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `${account!.code} — ${account!.name}` : 'New Account'}
      subtitle={
        editing
          ? account!.isSystem
            ? 'Part of the Annexure D master — name, notes and rules only'
            : 'Added here'
          : 'The code, nature and statement follow the group'
      }
      icon={<Wallet className="h-5 w-5" />}
      width="md"
      footer={<DrawerFooter onCancel={onClose} onSave={save} saving={saving} />}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {!editing && (
          <>
            <Select
              label="Scope"
              required
              value={form.scope}
              onChange={(e) =>
                setForm({ ...form, scope: e.target.value as Form['scope'] })
              }
              options={[
                { value: 'GROUP', label: 'Group master — every company may adopt it' },
                { value: 'PRIVATE', label: `Private to ${companyName}` },
              ]}
              className="sm:col-span-2"
            />
            <Select
              label="Group"
              required
              openOnFocus
              value={form.groupId}
              onChange={(e) => void onGroupChange(e.target.value)}
              options={groups.map((g) => ({
                value: String(g.id),
                label: `${g.code} — ${g.name}`,
              }))}
              placeholder="Choose a group"
              className="sm:col-span-2"
            />
          </>
        )}

        <Input
          label="Code"
          value={form.code}
          disabled={editing}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          placeholder={group ? `${group.code.slice(0, 3)}01 – ${group.code.slice(0, 3)}99` : '—'}
        />
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />

        {/* Fixed by the group — shown so the consequence of the choice is
            visible, never editable. */}
        {group && (
          <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
            <span className="text-slate-500">From the group: </span>
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {group.nature}
            </span>
            <span className="text-slate-400">
              {' '}
              · {group.statement === 'BS' ? 'Balance Sheet' : 'Profit & Loss'}
            </span>
            {group.tallyGroup && (
              <span className="text-slate-400"> · Tally: {group.tallyGroup}</span>
            )}
          </div>
        )}

        {!editing && (
          <div>
            <Select
              label="Normal side"
              value={form.normalSide}
              onChange={(e) => setForm({ ...form, normalSide: e.target.value })}
              options={SIDE_OPTIONS}
              placeholder="Follow the group"
            />
            <p className="mt-1 text-xs text-slate-400">
              Flip it only for a contra account, e.g. Purchase Returns.
            </p>
          </div>
        )}
        {/* What an entry to this account is asked for. Company and branch are
            asked for on every entry and are not settable here. */}
        <div className="sm:col-span-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Asked for at data entry
          </p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox
              label="Cost centre (division)"
              checked={form.hasCostCenter}
              onChange={(e) =>
                setForm({
                  ...form,
                  hasCostCenter: e.target.checked,
                  // A department has no division to sit in once the centre is
                  // no longer asked for.
                  hasCostObject: e.target.checked ? form.hasCostObject : false,
                })
              }
            />
            <Checkbox
              label="Cost object (department)"
              checked={form.hasCostObject}
              onChange={(e) =>
                setForm({
                  ...form,
                  hasCostObject: e.target.checked,
                  hasCostCenter: e.target.checked || form.hasCostCenter,
                })
              }
            />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Unticked, the entry screen does not ask and the field stays blank on
            the line. Company and branch are asked for on every entry.
          </p>
          {/* Level 1 overrides level 2, so say so where it bites rather than
              leaving a ticked box that nothing acts on. */}
          {account?.entryRules && form.hasCostCenter &&
            account.entryRules.costCenter === 'OFF' && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {companyName} is not set up for cost centres, so nothing is asked
                for here until that is turned on in the company master.
              </p>
            )}
          {account?.entryRules && form.hasCostObject &&
            account.entryRules.costObject === 'OFF' &&
            account.entryRules.costCenter !== 'OFF' && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {companyName} is not set up for cost objects, so only the cost
                centre is asked for here.
              </p>
            )}
        </div>

        <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          <Checkbox
            label="Contra — offsets its own group"
            checked={form.isContra}
            disabled={editing}
            onChange={(e) => setForm({ ...form, isContra: e.target.checked })}
          />
          <Checkbox
            label="Control — aged by a party"
            checked={form.isControl}
            disabled={editing}
            onChange={(e) => setForm({ ...form, isControl: e.target.checked })}
          />
          <Checkbox
            label="GST relevant"
            checked={form.isGstRelevant}
            disabled={editing}
            onChange={(e) => setForm({ ...form, isGstRelevant: e.target.checked })}
          />
          <Checkbox
            label="Bank or cash"
            checked={form.isBankOrCash}
            disabled={editing}
            onChange={(e) => setForm({ ...form, isBankOrCash: e.target.checked })}
          />
          <Checkbox
            label="Reconcilable"
            checked={form.isReconcilable}
            disabled={editing}
            onChange={(e) => setForm({ ...form, isReconcilable: e.target.checked })}
          />
          <Checkbox
            label="Allow manual journal"
            checked={form.allowManualJe}
            onChange={(e) => setForm({ ...form, allowManualJe: e.target.checked })}
          />
          {editing && (
            <Checkbox
              label="Active"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
          )}
        </div>

        {form.isControl && !editing && (
          <Select
            label="Aged by"
            required
            value={form.controlParty}
            onChange={(e) => setForm({ ...form, controlParty: e.target.value })}
            options={PARTY_OPTIONS}
            placeholder="Which party"
          />
        )}

        <Textarea
          label="Notes"
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="sm:col-span-2"
        />
      </div>
    </Drawer>
  );
}
