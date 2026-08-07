'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, MoneyInput } from '@/components/ui/Field';
import type { BalanceSide, OutstandingBill } from '@/lib/types';
import { money, num, paise } from './voucher-common';

/** One bill being settled, as the picker hands it back. */
export interface BillPick {
  id: number;
  /** How much of the line goes against it. Text, like every draft figure. */
  amount: string;
  /**
   * Which way the allocation pulls — the opposite of the way the bill stands,
   * because settling a bill moves it back towards nil. So an invoice is settled
   * one way and a credit note the other, and adjusting a note against an
   * invoice in the same breath comes out right without anyone doing the signs.
   */
  side: BalanceSide;
}

export interface BillPickerProps {
  open: boolean;
  onClose: () => void;
  /** Everything the party still owes — the whole list, not a search result. */
  bills: OutstandingBill[];
  partyLabel: string;
  /** What the line moves; the settlements have to come to exactly this. */
  lineAmount: string;
  /** The side of the line, which the selection has to net out on. */
  lineSide: BalanceSide;
  /** The NET of the line's OTHER rows, read against the line's side. */
  otherAllocated: number;
  /** Bills already being settled by this row, so reopening shows them ticked. */
  initial: BillPick[];
  onApply: (picks: BillPick[]) => void;
}

/**
 * Settle against bills by looking at them.
 *
 * Choosing which invoices a payment clears is not a lookup — the answer is not
 * a name someone already knows and can type. It is a decision made BY reading
 * the list: what is outstanding, how old it is, what is nearly due. So the
 * whole list is put on screen, oldest first, with what each still owes and how
 * far past due it is, and bills are ticked rather than searched for.
 *
 * Several at once, because one payment routinely clears several invoices. Each
 * ticked bill becomes its own allocation, which is what the sub-ledger needs:
 * "5,000 against INV-002 and INV-007" is two facts, and recording it as one
 * would leave neither bill knowing where it stands.
 *
 * A tick defaults to whatever is still unallocated on the line, capped by what
 * the bill has left — so ticking down a list fills the line and then stops,
 * instead of running past it and having to be corrected.
 */
export function BillPicker({
  open,
  onClose,
  bills,
  partyLabel,
  lineAmount,
  lineSide,
  otherAllocated,
  initial,
  onApply,
}: BillPickerProps) {
  // Ticked bill id -> the amount going against it.
  const [picked, setPicked] = useState<Map<number, string>>(new Map());
  const [filter, setFilter] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Reset to what the row already says each time it opens, so cancelling and
  // reopening never shows a half-made selection from last time.
  useEffect(() => {
    if (!open) return;
    setFilter('');
    setPicked(new Map(initial.map((p) => [p.id, p.amount])));
    // Focus the first row so the list can be worked with arrows and Space.
    const t = setTimeout(
      () => listRef.current?.querySelector<HTMLElement>('[data-bill-row]')?.focus(),
      120,
    );
    return () => clearTimeout(t);
    // `initial` is a fresh array each render; the open edge is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const q = filter.trim().toLowerCase();
  const shown = useMemo(
    () =>
      q
        ? bills.filter((b) => (b.billRef ?? '').toLowerCase().includes(q))
        : bills,
    [bills, q],
  );

  /** Settling a bill pulls the opposite way to the way it stands. */
  const settleSide = (b: OutstandingBill): BalanceSide =>
    b.side === 'DR' ? 'CR' : 'DR';

  const byId = useMemo(() => new Map(bills.map((b) => [b.id, b])), [bills]);

  /**
   * What the ticked bills come to, read against the LINE's side.
   *
   * An invoice and a credit note are settled in opposite directions, so this is
   * a net: tick both and the selection is what the payment actually comes to,
   * which is the figure that has to match the line.
   */
  const selected = useMemo(() => {
    let net = 0;
    for (const [id, amount] of picked) {
      const bill = byId.get(id);
      if (!bill) continue;
      net += settleSide(bill) === lineSide ? paise(amount) : -paise(amount);
    }
    return net;
  }, [picked, byId, lineSide]);

  const want = paise(lineAmount);
  /** What the line still has to account for once these settlements are counted. */
  const left = want - otherAllocated - selected;
  /** The whole point of the check: the line has to be exactly accounted for. */
  const matches = want > 0 && left === 0;

  const toggle = (b: OutstandingBill) => {
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(b.id)) {
        next.delete(b.id);
        return next;
      }
      // Take what the line still needs, but never more than the bill owes. A
      // bill settled the other way (a credit note) only ever adds to what is
      // left, so it goes in at its full value.
      let net = 0;
      for (const [id, a] of next) {
        const bill = byId.get(id);
        if (bill) net += settleSide(bill) === lineSide ? paise(a) : -paise(a);
      }
      const room = want - otherAllocated - net;
      const take =
        settleSide(b) === lineSide && room > 0
          ? Math.min(paise(b.pending), room)
          : paise(b.pending);
      next.set(b.id, (take / 100).toFixed(2));
      return next;
    });
  };

  /** Arrow keys walk the list; Space ticks; the row is one stop for Tab. */
  const onRowKeyDown = (e: React.KeyboardEvent, b: OutstandingBill) => {
    // Keys pressed INSIDE the settle amount belong to that field. Without this
    // the row swallows them — Space unticks the bill being typed against and
    // the arrows jump away mid-figure, which made a part payment impossible to
    // enter from the keyboard at all.
    if (e.target !== e.currentTarget) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle(b);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-bill-row]') ?? [],
    );
    const i = rows.indexOf(e.currentTarget as HTMLElement);
    rows[e.key === 'ArrowDown' ? i + 1 : i - 1]?.focus();
  };

  const apply = () => {
    if (!matches) return;
    onApply(
      // In the order they are listed — oldest bill first, which is the order a
      // party's account is settled in and read in.
      bills
        .filter((b) => picked.has(b.id) && num(picked.get(b.id)) > 0)
        .map((b) => ({
          id: b.id,
          amount: picked.get(b.id)!,
          side: settleSide(b),
        })),
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Settle against bills"
      subtitle={`${partyLabel} · line ${money(lineAmount)}`}
      width="xl"
      footer={
        <DrawerFooter
          onCancel={onClose}
          onSave={apply}
          saveDisabled={!matches}
          saveLabel={
            matches
              ? `Settle ${picked.size} bill${picked.size === 1 ? '' : 's'}`
              : want === 0
                ? 'Enter the line amount first'
                : left > 0
                  ? `${money(left / 100)} still to allocate`
                  : `${money(-left / 100)} over the line`
          }
        />
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          {/* The selection has to come to the line exactly — that is what
              bill-wise tracking IS, and the server refuses anything else. Said
              here, while it can still be acted on, rather than on save. */}
          <span
            className={cn(
              'text-sm',
              matches
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400',
            )}
          >
            {money(selected / 100)} {lineSide} selected
            {want === 0
              ? ' · the line has no amount yet'
              : left === 0
                ? ' · matches the line'
                : left > 0
                  ? ` · ${money(left / 100)} short of the line`
                  : ` · ${money(-left / 100)} over the line`}
          </span>
          {bills.length > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                className="text-brand-600 hover:underline"
                onClick={() =>
                  setPicked(
                    new Map(shown.map((b) => [b.id, b.pending.toFixed(2)])),
                  )
                }
              >
                Tick all shown
              </button>
              <button
                type="button"
                className="text-slate-500 hover:underline"
                onClick={() => setPicked(new Map())}
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* A filter, not a search box: the list is meant to be read, and this
            is only for the party who has two hundred open invoices. */}
        {bills.length > 8 && (
          <Input
            value={filter}
            placeholder="Narrow the list by bill number…"
            onChange={(e) => setFilter(e.target.value)}
          />
        )}

        {bills.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
            Nothing outstanding for {partyLabel}. An amount that settles no bill
            is an advance or on account — choose one of those instead.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="grid grid-cols-[2rem_1fr_6rem_6rem_7rem_2.5rem_7rem] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
              <span />
              <span>Bill</span>
              <span>Dated</span>
              <span>Due</span>
              <span className="text-right">Pending</span>
              {/* Which way the bill stands, so an invoice and a credit note are
                  told apart at a glance rather than by their sign. */}
              <span className="text-center">Dr/Cr</span>
              <span className="text-right">Settle</span>
            </div>
            <div ref={listRef} className="max-h-[26rem] overflow-y-auto">
              {shown.map((b) => {
                const on = picked.has(b.id);
                const amount = picked.get(b.id) ?? '';
                const over = paise(amount) > paise(b.pending);
                return (
                  <div
                    key={b.id}
                    data-bill-row=""
                    role="checkbox"
                    aria-checked={on}
                    tabIndex={0}
                    onKeyDown={(e) => onRowKeyDown(e, b)}
                    onClick={() => toggle(b)}
                    className={cn(
                      'grid cursor-pointer grid-cols-[2rem_1fr_6rem_6rem_7rem_2.5rem_7rem] items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-sm outline-none last:border-0 focus:bg-brand-50 dark:border-slate-800 dark:focus:bg-brand-950/30',
                      on && 'bg-emerald-50/60 dark:bg-emerald-950/20',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      tabIndex={-1}
                      readOnly
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 dark:border-slate-600 dark:bg-slate-800"
                    />
                    <span className="truncate font-medium">
                      {b.billRef ?? '—'}
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(b.date).toLocaleDateString()}
                    </span>
                    <span
                      className={cn(
                        'text-xs',
                        b.overdueDays > 0
                          ? 'font-medium text-rose-600 dark:text-rose-400'
                          : 'text-slate-500',
                      )}
                      title={
                        b.overdueDays > 0
                          ? `${b.overdueDays} days past due`
                          : 'Within the agreed credit period'
                      }
                    >
                      {b.dueDate ? new Date(b.dueDate).toLocaleDateString() : '—'}
                    </span>
                    <span className="text-right tabular-nums">
                      {money(b.pending)}
                    </span>
                    <span
                      className="text-center text-xs font-semibold text-slate-500"
                      title={
                        settleSide(b) === lineSide
                          ? 'Settling this moves the line its own way'
                          : 'Settling this pulls against the line — an adjustment'
                      }
                    >
                      {b.side === 'DR' ? 'Dr' : 'Cr'}
                    </span>
                    {/* Stops the click bubbling to the row, or typing in the
                        amount would untick the bill it belongs to. */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <MoneyInput
                        value={amount}
                        disabled={!on}
                        className={cn(
                          'h-8 text-sm',
                          over && 'border-rose-400 text-rose-600',
                        )}
                        title={
                          over
                            ? `Only ${money(b.pending)} is outstanding on this bill`
                            : undefined
                        }
                        onChange={(next) =>
                          setPicked((m) => new Map(m).set(b.id, next))
                        }
                      />
                    </div>
                  </div>
                );
              })}
              {shown.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-slate-400">
                  No bill matches “{filter}”.
                </p>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-slate-400">
          ↑ ↓ to move, Space to tick. A tick takes what the line still needs,
          capped by what the bill owes — type over it for a part payment. A bill
          standing the other way (a credit note) is adjusted against the rest
          rather than added to them.
        </p>
      </div>
    </Drawer>
  );
}
