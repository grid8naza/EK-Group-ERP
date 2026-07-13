'use client';

import { useState } from 'react';
import { BarChart2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Bespoke, pixel-accurate Production Dashboard (rendered for dashboard id 2).
 * Charts are inline SVG / CSS so there's no charting dependency. The figures
 * below are the sample values from the approved design — swap these consts for
 * live production-order aggregates when the endpoints are ready.
 */

// ---- sample data -----------------------------------------------------------

const STATS = [
  {
    label: 'Planned',
    value: 2,
    badge: '+1 today',
    badgeTone: 'slate' as const,
    hint: 'Orders awaiting start',
    tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
    spark: '#2f6b58',
    points: [4, 5, 4, 6, 5, 7, 8],
  },
  {
    label: 'In Progress',
    value: 6,
    badge: 'Live',
    badgeTone: 'amber' as const,
    hint: 'Running on the line',
    tile: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
    spark: '#d4a017',
    points: [3, 4, 3, 5, 6, 5, 6],
  },
  {
    label: 'Completed',
    value: 4,
    badge: '▲ 12%',
    badgeTone: 'green' as const,
    hint: 'Finished this week',
    tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
    spark: '#2f6b58',
    points: [2, 3, 3, 4, 4, 5, 6],
  },
  {
    label: 'Total Orders',
    value: 12,
    badge: '▲ 4%',
    badgeTone: 'green' as const,
    hint: 'All production orders',
    tile: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300',
    spark: '#334155',
    points: [8, 9, 9, 10, 11, 11, 12],
  },
];

const OUTPUT = [
  { d: 'Mon', v: 9 },
  { d: 'Tue', v: 12 },
  { d: 'Wed', v: 8 },
  { d: 'Thu', v: 15 },
  { d: 'Fri', v: 11 },
  { d: 'Sat', v: 14 },
  { d: 'Sun', v: 6 },
];

const STATUS = [
  { label: 'Completed', value: 4, color: '#2f6b58' },
  { label: 'In Progress', value: 6, color: '#d4a017' },
  { label: 'Planned', value: 2, color: '#cbd5e1' },
];

const ORDERS = [
  { id: 'PO-1042', product: 'Cake - Red Bee 1 Kg', qty: '120 Nos', status: 'In Progress' },
  { id: 'PO-1041', product: 'Cake - White Chip 1 Kg', qty: '80 Nos', status: 'Completed' },
  { id: 'PO-1040', product: 'Bun - Classic', qty: '300 Nos', status: 'Planned' },
  { id: 'PO-1039', product: 'Loaf Bread', qty: '150 Nos', status: 'Completed' },
];

const RECIPES = [
  { name: 'Red Velvet Cake', batches: 42, pct: 92 },
  { name: 'White Chip Cookie', batches: 36, pct: 78 },
  { name: 'Classic Bun', batches: 28, pct: 61 },
  { name: 'Sourdough Loaf', batches: 21, pct: 46 },
];

// ---- small building blocks -------------------------------------------------

const BADGE_TONES: Record<'slate' | 'amber' | 'green', string> = {
  slate: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
};

function Sparkline({ color, points }: { color: string; points: number[] }) {
  const w = 84;
  const h = 34;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => `${(i * step).toFixed(1)},${(h - ((p - min) / range) * h).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      className="overflow-visible"
      aria-hidden
    >
      <polyline
        points={d}
        stroke={color}
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'Completed'
      ? { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' }
      : status === 'In Progress'
        ? { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400' }
        : { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300' };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        tone.chip,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
      {status}
    </span>
  );
}

function OrderStatusDonut() {
  const total = STATUS.reduce((n, s) => n + s.value, 0);
  const r = 68;
  const cx = 90;
  const cy = 90;
  let cumulative = 0;
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-44 w-44">
        <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90">
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="16"
            className="text-slate-100 dark:text-slate-800"
          />
          {STATUS.map((s) => {
            const seg = (
              <circle
                key={s.label}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="16"
                strokeLinecap="round"
                pathLength={total}
                strokeDasharray={`${s.value} ${total - s.value}`}
                strokeDashoffset={-cumulative}
              />
            );
            cumulative += s.value;
            return seg;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-slate-900 dark:text-white">
            {total}
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Total
          </span>
        </div>
      </div>
      <ul className="mt-6 w-full space-y-3">
        {STATUS.map((s) => (
          <li key={s.label} className="flex items-center gap-3 text-sm">
            <span
              className="h-2.5 w-2.5 flex-none rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="flex-1 text-slate-600 dark:text-slate-300">
              {s.label}
            </span>
            <span className="font-semibold text-slate-900 dark:text-white">
              {s.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- dashboard -------------------------------------------------------------

export function ProductionDashboard() {
  const [range, setRange] = useState<'Week' | 'Month'>('Week');
  const maxV = Math.max(...OUTPUT.map((o) => o.v));

  return (
    <div className="space-y-4">
      {/* Header banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900 px-6 py-7 sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="relative">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-100">
            <BarChart2 className="h-4 w-4" />
            Production
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
            Production Dashboard
          </h1>
          <p className="mt-2 max-w-lg text-sm text-brand-100/80">
            Drag widgets by their handle to arrange your personal layout.
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="card p-5">
            <div className="flex items-start justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {s.label}
              </p>
              <span
                className={cn(
                  'flex h-9 w-9 flex-none items-center justify-center rounded-xl',
                  s.tile,
                )}
              >
                <BarChart2 className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-4xl font-bold leading-none text-slate-900 dark:text-white">
                  {s.value}
                </span>
                <span
                  className={cn(
                    'rounded-md px-2 py-0.5 text-xs font-medium',
                    BADGE_TONES[s.badgeTone],
                  )}
                >
                  {s.badge}
                </span>
              </div>
              <Sparkline color={s.spark} points={s.points} />
            </div>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              {s.hint}
            </p>
          </div>
        ))}
      </div>

      {/* Output + Order status */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Production Output */}
        <div className="card p-6 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Production Output
              </h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Batches completed this {range.toLowerCase()}
              </p>
            </div>
            <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100/70 p-1 dark:border-slate-800 dark:bg-slate-900">
              {(['Week', 'Month'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={cn(
                    'rounded-full px-4 py-1.5 text-sm font-medium transition',
                    range === r
                      ? 'bg-white text-brand-700 dark:bg-slate-700 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-8 flex items-end justify-between gap-2 sm:gap-4">
            {OUTPUT.map((b) => (
              <div
                key={b.d}
                className="flex flex-1 flex-col items-center justify-end"
              >
                <span className="mb-2 text-xs font-medium text-slate-400">
                  {b.v}
                </span>
                <div
                  className="w-8 rounded-t-lg bg-gradient-to-t from-brand-800 to-brand-500 sm:w-10"
                  style={{ height: `${(b.v / maxV) * 190}px` }}
                />
                <span className="mt-3 text-xs text-slate-400">{b.d}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Order Status */}
        <div className="card p-6">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Order Status
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Breakdown of all orders
          </p>
          <div className="mt-6">
            <OrderStatusDonut />
          </div>
        </div>
      </div>

      {/* Recent orders + Top recipes */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Recent Production Orders
            </h2>
            <button
              type="button"
              className="text-sm font-semibold text-brand-700 hover:text-brand-600 dark:text-brand-400"
            >
              View all
            </button>
          </div>
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:border-slate-800">
                <th className="py-2.5 pr-3">Order</th>
                <th className="py-2.5 pr-3">Product</th>
                <th className="py-2.5 pr-3">Quantity</th>
                <th className="py-2.5 pr-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {ORDERS.map((o, i) => (
                <tr
                  key={o.id}
                  className={cn(
                    'border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-100/70 dark:border-slate-800/60 dark:hover:bg-slate-800/50',
                    i % 2 === 1 && 'bg-slate-50/70 dark:bg-slate-900/40',
                  )}
                >
                  <td className="py-3 pr-3 font-medium tabular-nums text-slate-700 dark:text-slate-200">
                    {o.id}
                  </td>
                  <td className="py-3 pr-3 font-semibold text-slate-900 dark:text-white">
                    {o.product}
                  </td>
                  <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">
                    {o.qty}
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <StatusPill status={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Top Recipes
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            By batches this month
          </p>
          <ul className="mt-5 space-y-4">
            {RECIPES.map((r) => (
              <li key={r.name}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {r.name}
                  </span>
                  <span className="tabular-nums text-slate-500 dark:text-slate-400">
                    {r.batches}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400"
                    style={{ width: `${r.pct}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
