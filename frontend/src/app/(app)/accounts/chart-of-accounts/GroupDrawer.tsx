'use client';

import { useEffect, useState } from 'react';
import { FolderTree } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, Select } from '@/components/ui/Field';
import type { AccountGroup } from '@/lib/types';

const NATURE_OPTIONS = [
  { value: 'ASSET', label: 'Asset — Balance Sheet' },
  { value: 'LIABILITY', label: 'Liability — Balance Sheet' },
  { value: 'EQUITY', label: 'Equity — Balance Sheet' },
  { value: 'INCOME', label: 'Income — Profit & Loss' },
  { value: 'EXPENSE', label: 'Expense — Profit & Loss' },
];

/**
 * Add a group heading.
 *
 * A group is a HEADING, never posted to, which is what its code ending in 00
 * signifies. A child takes its nature from the parent it rolls up into — letting
 * it differ would put a balance in a different statement from its own parent.
 */
export function GroupDrawer({
  open,
  groups,
  onClose,
  onSaved,
}: {
  open: boolean;
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode('');
    setName('');
    setParentId('');
    setNature('');
    setTallyGroup('');
  }, [open]);

  const parent = groups.find((g) => String(g.id) === parentId);

  const save = async () => {
    if (!/^\d{3}00$/.test(code.trim())) {
      return toast.error('A group code is five digits ending in 00.');
    }
    if (!name.trim()) return toast.error('Give the group a name.');
    if (!parent && !nature) return toast.error('Choose what the group holds.');
    setSaving(true);
    try {
      await api.post('/coa/groups', {
        code: code.trim(),
        name,
        parentGroupId: parent ? parent.id : undefined,
        nature: parent ? undefined : nature,
        tallyGroup: tallyGroup || undefined,
      });
      toast.success('Group added.');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to add the group.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New Group"
      subtitle="A heading in the hierarchy — never posted to"
      icon={<FolderTree className="h-5 w-5" />}
      width="sm"
      footer={<DrawerFooter onCancel={onClose} onSave={save} saving={saving} />}
    >
      <div className="grid grid-cols-1 gap-4">
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

        <div>
          <Input
            label="Code"
            required
            value={code}
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

        {!parent && (
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
      </div>
    </Drawer>
  );
}

/** Small explanatory line under a field — the Field components have no hint slot. */
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-slate-400">{children}</p>;
}
