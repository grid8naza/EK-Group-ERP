'use client';

import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { Drawer } from '@/components/ui/Drawer';
import { Checkbox, DateInput, Select } from '@/components/ui/Field';
import { PeopleField, type PickedPerson } from '@/components/workplace/people';
import type { Task, TaskPriority } from '@/lib/types';
import type { TaskSide } from '@/components/workplace/task-ui';

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

/**
 * Raise a task.
 *
 * Opened from either board, and it opens differently on each: from your own
 * list the work starts out yours, from the list of work you give out it starts
 * out nobody's until you say who. That is the difference between writing
 * yourself a note and delegating something.
 *
 * The company and branch are NOT asked for — a task belongs where the person
 * raising it is working, and the server stamps it from the active context.
 * "Company-wide" is the one choice worth offering, because a standing
 * instruction for every branch is a real thing and cannot be inferred.
 */
export function TaskComposer({
  open,
  side,
  onClose,
  onCreated,
}: {
  open: boolean;
  side: TaskSide;
  onClose: () => void;
  onCreated: (task: Task) => void;
}) {
  // `branches` is empty unless the active company is branch-applicable, which
  // is exactly when "company-wide or this branch?" is a question worth asking.
  const { user, branches } = useAuth();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignees, setAssignees] = useState<PickedPerson[]>([]);
  const [priority, setPriority] = useState<TaskPriority>('NORMAL');
  const [dueAt, setDueAt] = useState('');
  const [companyWide, setCompanyWide] = useState(false);
  const [checklist, setChecklist] = useState<string[]>([]);
  const [line, setLine] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset every time it opens, so yesterday's half-written task is never
  // waiting inside a form that looks blank.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setAssignees(
      side === 'to-me' && user
        ? [{ id: user.id, name: user.name ?? 'Me' }]
        : [],
    );
    setPriority('NORMAL');
    setDueAt('');
    setCompanyWide(false);
    setChecklist([]);
    setLine('');
  }, [open, side, user]);

  const addLine = () => {
    const text = line.trim();
    if (!text) return;
    setChecklist((list) => [...list, text]);
    setLine('');
  };

  const save = async () => {
    if (saving) return;
    if (!title.trim()) {
      toast.error('Give the task a title.');
      return;
    }
    setSaving(true);
    try {
      const task = await api.post<Task>('/tasks', {
        title: title.trim(),
        description: description.trim() || undefined,
        assigneeIds: assignees.map((a) => a.id),
        priority,
        dueAt: dueAt || undefined,
        companyWide,
        checklist,
      });
      toast.success('Task raised.');
      onCreated(task);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The task was not saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New task"
      subtitle="What needs doing, who for, and by when"
      width="md"
      icon={<Plus className="h-5 w-5" />}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Raise task'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Closing checks — main kitchen"
            maxLength={200}
            autoFocus
            className="input-base w-full"
          />
        </div>

        <PeopleField
          label="Assign to"
          endpoint="/tasks/directory"
          chosen={assignees}
          onChange={setAssignees}
          placeholder="Search people…"
        />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Priority"
            options={PRIORITIES}
            value={priority}
            sortOptions={false}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
          />
          <DateInput label="Due" value={dueAt} onChange={setDueAt} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Details
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Anything the person doing it needs to know…"
            className="input-base min-h-[100px] w-full resize-y"
          />
        </div>

        {/* Only worth asking where branches exist at all. */}
        {branches.length > 0 && (
          <Checkbox
            label="For the whole company, not just this branch"
            checked={companyWide}
            onChange={(e) => setCompanyWide(e.target.checked)}
          />
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Checklist
          </label>
          {checklist.length > 0 && (
            <ul className="mb-2 space-y-1">
              {checklist.map((text, i) => (
                <li
                  key={`${text}-${i}`}
                  className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm dark:bg-slate-800"
                >
                  <span className="flex-1">{text}</span>
                  <button
                    type="button"
                    className="text-slate-400 hover:text-rose-500"
                    onClick={() =>
                      setChecklist((list) => list.filter((_, x) => x !== i))
                    }
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              value={line}
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLine();
                }
              }}
              placeholder="Add a step, then Enter"
              className="input-base flex-1"
            />
            <button type="button" className="btn-secondary" onClick={addLine}>
              Add
            </button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
