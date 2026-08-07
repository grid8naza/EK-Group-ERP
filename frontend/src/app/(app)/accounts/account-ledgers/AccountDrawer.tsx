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

/**
 * What each rule on this account actually means, in the words an accountant
 * would use — with a real account from the chart, because "offsets its own
 * group" means little until you see Accumulated Depreciation doing it.
 *
 * Kept beside the form rather than in the database: these describe what the
 * software DOES with the tick, so they change when the code changes, not when
 * an administrator decides.
 */
const HELP = {
  hasCostCenter:
    'Tick to have the entry screen ask which division a line to this account belongs to — kitchen, cafe, a vehicle. Untick and it never asks, and the line is saved without one.',
  hasCostObject:
    'The department under the division. A department cannot be named without its division, so ticking this ticks the cost centre too.',
  isContra:
    'The account sits inside a block but REDUCES it rather than adding to it. Accumulated Depreciation sits under Fixed Assets and nets against them, so the balance sheet shows the asset at cost less depreciation instead of two separate lines.',
  isControl:
    'The balance is only a total — the detail is per party. Sundry Creditors is really the sum of what you owe each supplier, so an entry here records WHICH supplier and the account is aged and settled bill by bill.',
  isGstRelevant:
    'The account feeds the GST returns — output tax, input credit, reverse charge. Tick it on the tax heads, not on the sales or purchase account itself.',
  isCash:
    'Money in hand: a till, a petty cash box, cash on its way between two of them. Counted by counting it, and what a Cash Receipt or Cash Payment pays into and out of.',
  isBank:
    'Money at a bank: a current account, a deposit. Agreed against a statement rather than counted, and what a Bank Receipt or Bank Payment pays into and out of.',
  isPdcIssued:
    'Where a post-dated cheque WE wrote waits between the day it is handed over and the day it is presented. Not money — a promise, standing as a liability. A Bank Payment by post-dated cheque offers only these, and the PDC Register clears it out of here into the bank on the day it goes.',
  isPdcReceived:
    'The other side of the same idea: a post-dated cheque somebody gave US, held as an asset until it clears. A Bank Receipt by post-dated cheque offers only these. An account is one of cash, bank, PDC issued or PDC received — never two.',
  isReconcilable:
    'The balance is agreed against a statement from outside — a bank statement, a supplier statement. Cash in Transit is ticked because money that has left one place and not yet arrived must be tied out.',
  allowManualJe:
    'Whether a person may name this account on a hand-written voucher. Untick it and the account moves only when a module posts to it, so a balance the system maintains cannot be nudged by hand.',
  isActive:
    'Untick to retire the account. It keeps everything already posted to it and stops being offered on new entries.',
};

/**
 * Where the money sits, as four boxes of which at most one may be ticked.
 *
 * Ticking one clears the others rather than refusing the pair: moving an
 * account from Bank to PDC issued is a correction, not a mistake to argue with.
 * The server holds the same rule, so a payload that says two is still refused.
 */
const MONEY_FLAGS = ['isCash', 'isBank', 'isPdcIssued', 'isPdcReceived'] as const;
type MoneyFlag = (typeof MONEY_FLAGS)[number];

const money = (flag: MoneyFlag, on: boolean) =>
  Object.fromEntries(
    MONEY_FLAGS.map((f) => [f, f === flag ? on : false]),
  ) as Record<MoneyFlag, boolean>;

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
  isCash: boolean;
  isBank: boolean;
  isPdcIssued: boolean;
  isPdcReceived: boolean;
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
  isCash: false,
  isBank: false,
  isPdcIssued: false,
  isPdcReceived: false,
  isReconcilable: false,
  allowManualJe: true,
  notes: '',
  isActive: true,
};

/**
 * Add or edit a ledger account.
 *
 * On an EXISTING account only the NAME and whether it is still in use may
 * change. Everything else is settled at creation — the code and group decide
 * where a balance lands, the cost boxes decide what a posting is asked for, and
 * the postings already made cannot be asked to mean something else. The fields
 * stay on screen rather than disappearing, because what an account is remains
 * worth reading; they are simply not editable.
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
            isCash: account.isCash,
            isBank: account.isBank,
            isPdcIssued: account.isPdcIssued,
            isPdcReceived: account.isPdcReceived,
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
        // Only these two: everything else about an account is settled when it
        // is created, because it changes what a posting to it means.
        await api.patch(`/coa/accounts/${account!.id}`, {
          name: form.name,
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
          isCash: form.isCash,
          isBank: form.isBank,
          isPdcIssued: form.isPdcIssued,
          isPdcReceived: form.isPdcReceived,
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
              help={HELP.hasCostCenter}
              checked={form.hasCostCenter}
              disabled={editing}
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
              help={HELP.hasCostObject}
              checked={form.hasCostObject}
              disabled={editing}
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
            help={HELP.isContra}
            checked={form.isContra}
            disabled={editing}
            onChange={(e) => setForm({ ...form, isContra: e.target.checked })}
          />
          <Checkbox
            label="Control — aged by a party"
            help={HELP.isControl}
            checked={form.isControl}
            disabled={editing}
            onChange={(e) => setForm({ ...form, isControl: e.target.checked })}
          />
          <Checkbox
            label="GST relevant"
            help={HELP.isGstRelevant}
            checked={form.isGstRelevant}
            disabled={editing}
            onChange={(e) => setForm({ ...form, isGstRelevant: e.target.checked })}
          />
          {/* One or the other: ticking one clears the other rather than
              refusing the pair, since choosing "bank" over "cash" is a
              correction, not a mistake to be argued with. */}
          <Checkbox
            label="Cash"
            help={HELP.isCash}
            checked={form.isCash}
            disabled={editing}
            onChange={(e) => setForm({ ...form, ...money('isCash', e.target.checked) })}
          />
          <Checkbox
            label="Bank"
            help={HELP.isBank}
            checked={form.isBank}
            disabled={editing}
            onChange={(e) => setForm({ ...form, ...money('isBank', e.target.checked) })}
          />
          <Checkbox
            label="PDC issued"
            help={HELP.isPdcIssued}
            checked={form.isPdcIssued}
            disabled={editing}
            onChange={(e) =>
              setForm({ ...form, ...money('isPdcIssued', e.target.checked) })
            }
          />
          <Checkbox
            label="PDC received"
            help={HELP.isPdcReceived}
            checked={form.isPdcReceived}
            disabled={editing}
            onChange={(e) =>
              setForm({ ...form, ...money('isPdcReceived', e.target.checked) })
            }
          />
          <Checkbox
            label="Reconcilable"
            help={HELP.isReconcilable}
            checked={form.isReconcilable}
            disabled={editing}
            onChange={(e) => setForm({ ...form, isReconcilable: e.target.checked })}
          />
          <Checkbox
            label="Allow manual journal"
            help={HELP.allowManualJe}
            checked={form.allowManualJe}
            disabled={editing}
            onChange={(e) => setForm({ ...form, allowManualJe: e.target.checked })}
          />
          {editing && (
            <Checkbox
              label="Active"
              help={HELP.isActive}
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
          disabled={editing}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="sm:col-span-2"
        />
      </div>
    </Drawer>
  );
}
