'use client';

import { useEffect, useState } from 'react';
import { FolderTree } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Checkbox, Input, Select } from '@/components/ui/Field';
import type { AccountGroup } from '@/lib/types';

const NATURE_OPTIONS = [
  { value: 'ASSET', label: 'Asset — Balance Sheet' },
  { value: 'LIABILITY', label: 'Liability — Balance Sheet' },
  { value: 'EQUITY', label: 'Equity — Balance Sheet' },
  { value: 'INCOME', label: 'Income — Profit & Loss' },
  { value: 'EXPENSE', label: 'Expense — Profit & Loss' },
];

/**
 * Add or edit a group heading.
 *
 * A group is a HEADING, never posted to, which is what its code ending in 00
 * signifies. A child takes its nature from the parent it rolls up into — letting
 * it differ would put a balance in a different statement from its own parent.
 *
 * On an EXISTING group the code, parent and nature are read-only, for the same
 * reason the account form fixes its own structural fields: changing one would
 * move balances between statements after the fact.
 */
export function GroupDrawer({
  open,
  group,
  groups,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = creating. */
  group?: AccountGroup | null;
  groups: AccountGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [nature, setNature] = useState('');
  const [tallyGroup, setTallyGroup] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const editing = !!group;

  useEffect(() => {
    if (!open) return;
    setCode(group?.code ?? '');
    setName(group?.name ?? '');
    setParentId(group?.parentGroupId ? String(group.parentGroupId) : '');
    setNature(group?.nature ?? '');
    setTallyGroup(group?.tallyGroup ?? '');
    setIsActive(group?.isActive ?? true);
  }, [open, group]);

  const parent = groups.find((g) => String(g.id) === parentId);

  const save = async () => {
    if (!name.trim()) return toast.error('Give the group a name.');
    if (!editing) {
      if (!/^\d{3}00$/.test(code.trim())) {
        return toast.error('A group code is five digits ending in 00.');
      }
      if (!parent && !nature) return toast.error('Choose what the group holds.');
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/coa/groups/${group!.id}`, {
          name,
          tallyGroup,
          isActive,
        });
        toast.success('Group saved.');
      } else {
        await api.post('/coa/groups', {
          code: code.trim(),
          name,
          parentGroupId: parent ? parent.id : undefined,
          nature: parent ? undefined : nature,
          tallyGroup: tallyGroup || undefined,
        });
        toast.success('Group added.');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save the group.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `${group!.code} — ${group!.name}` : 'New Group'}
      subtitle={
        editing
          ? group!.isSystem
            ? 'Part of the Annexure D master — name, Tally group and status only'
            : 'Added here'
          : 'A heading in the hierarchy — never posted to'
      }
      icon={<FolderTree className="h-5 w-5" />}
      width="sm"
      footer={<DrawerFooter onCancel={onClose} onSave={save} saving={saving} />}
    >
      <div className="grid grid-cols-1 gap-4">
        {!editing && (
          <div>
            <Select
              label="Parent group"
              openOnFocus
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              options={groups.map((g) => ({
                value: String(g.id),
                label: `${g.code} — ${g.name}`,
              }))}
              placeholder="None — a new top-level block"
            />
            <Hint>
              {parent
                ? `Must be numbered ${parent.code.slice(0, 2)}x00, and it inherits ${parent.nature}.`
                : 'A top-level group starts its own block, e.g. 10000 or 21000.'}
            </Hint>
          </div>
        )}

        <div>
          <Input
            label="Code"
            required
            value={code}
            disabled={editing}
            onChange={(e) => setCode(e.target.value)}
            placeholder={parent ? `${parent.code.slice(0, 2)}_00` : '_____00'}
          />
          <Hint>Five digits ending in 00 — the 00 is what makes it a heading.</Hint>
        </div>

        <Input
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        {!parent && !editing && (
          <div>
            <Select
              label="Holds"
              required
              value={nature}
              onChange={(e) => setNature(e.target.value)}
              options={NATURE_OPTIONS}
              placeholder="Choose"
            />
            <Hint>This fixes the statement; a child group follows its parent.</Hint>
          </div>
        )}

        <div>
          <Input
            label="Tally primary group"
            value={tallyGroup}
            onChange={(e) => setTallyGroup(e.target.value)}
            placeholder={parent?.tallyGroup ?? 'Optional'}
          />
          <Hint>The migration key for the books kept in Tally today.</Hint>
        </div>

        {editing && (
          <Checkbox
            label="Active"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
        )}
      </div>
    </Drawer>
  );
}

/** Small explanatory line under a field — the Field components have no hint slot. */
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-slate-400">{children}</p>;
}
