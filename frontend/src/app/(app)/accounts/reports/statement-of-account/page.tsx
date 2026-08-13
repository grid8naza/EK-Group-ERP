'use client';

import { useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Input, Select } from '@/components/ui/Field';
import { ColumnToggle } from '@/components/ui/ColumnToggle';
import {
  ReportView,
  ReportExportButtons,
  useReportColumns,
} from '@/components/ui/ReportView';
import {
  printReport,
  pdfReport,
  excelReport,
  resolveCompanyName,
  type ReportBlock,
  type ReportColumn,
  type ReportSpec,
} from '@/lib/reportDoc';
import type {
  Company,
  PartyLite,
  PartyStatement,
  StatementRow,
} from '@/lib/types';

const ROUTE = '/accounts/reports/statement-of-account';

const money = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const asDate = (iso: string) => new Date(iso).toLocaleDateString();

const ALL_COLUMNS: ReportColumn<StatementRow>[] = [
  { key: 'date', header: 'Date', weight: 10, cell: (r) => asDate(r.date) },
  {
    key: 'voucherNo',
    header: 'Voucher',
    weight: 16,
    dark: true,
    cell: (r) => r.voucherNo,
  },
  {
    key: 'voucherType',
    header: 'Type',
    weight: 12,
    cell: (r) => r.voucherType,
  },
  {
    // Which bills the entry touched. This is the column that makes a statement
    // answerable — "what is this 400 against?" is otherwise unanswerable.
    key: 'bills',
    header: 'Bills',
    weight: 18,
    cell: (r) =>
      r.bills.length
        ? r.bills
            .map((b) =>
              b.refType === 'ON_ACCOUNT'
                ? 'On account'
                : b.refType === 'ADVANCE'
                  ? 'Advance'
                  : `${b.billRef ?? '—'} ${money(b.amount)}`,
            )
            .join(', ')
        : '',
  },
  {
    key: 'narration',
    header: 'Narration',
    weight: 22,
    cell: (r) => r.narration ?? '',
  },
  {
    key: 'debit',
    header: 'Debit',
    weight: 12,
    numeric: true,
    cell: (r) => (r.debit ? money(r.debit) : ''),
  },
  {
    key: 'credit',
    header: 'Credit',
    weight: 12,
    numeric: true,
    cell: (r) => (r.credit ? money(r.credit) : ''),
  },
  {
    key: 'balance',
    header: 'Balance',
    weight: 14,
    numeric: true,
    // Dr / Cr rather than a minus sign: a negative balance on a supplier means
    // nothing to read at a glance, "1,200 Cr" means they are owed.
    cell: (r) =>
      `${money(Math.abs(r.balance))} ${r.balance >= 0 ? 'Dr' : 'Cr'}`,
  },
];

/**
 * Statement of account — one party's ledger, in the order it happened.
 *
 * What you send a customer who asks what they owe, and what you check a
 * supplier's own statement against. The opening balance collapses everything
 * before the period into one figure, so a statement for a month still
 * reconciles rather than starting from nothing.
 */
export default function StatementOfAccountPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();

  const [partyKind, setPartyKind] = useState<'CUSTOMER' | 'SUPPLIER'>(
    'CUSTOMER',
  );
  const [partyId, setPartyId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: parties } = useFetch<PartyLite[]>(
    `/party-ledger/parties?partyKind=${partyKind}`,
    [partyKind],
  );
  const { data: companies } = useFetch<Company[]>('/companies');

  const query = [
    `partyKind=${partyKind}`,
    `partyId=${partyId}`,
    from ? `from=${from}` : '',
    to ? `to=${to}` : '',
  ]
    .filter(Boolean)
    .join('&');
  const { data, loading } = useFetch<PartyStatement>(
    partyId ? `/party-ledger/statement?${query}` : null,
    [query],
  );

  const { hidden, toggle, selected } = useReportColumns(ROUTE, ALL_COLUMNS);
  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  const blocks = useMemo(() => {
    if (!data?.rows.length) return [] as ReportBlock[];
    return [
      {
        section: data.party.name,
        heading: `${data.party.code}${
          data.party.creditDays != null
            ? ` · ${data.party.creditDays} days credit`
            : ''
        }`,
        count: data.rows.length,
        tables: [{ rows: data.rows.map(selected.cells) }],
      },
    ];
  }, [data, selected]);

  const summary = useMemo(
    () =>
      data
        ? [
            // Signed: positive is a debit balance, negative a credit one. The
            // Dr/Cr wording lives in the Balance column, where there is room
            // for it.
            { label: 'Opening', value: data.openingBalance },
            { label: 'Entries', value: data.rows.length },
            {
              label: 'Debits',
              value: data.rows.reduce((s, r) => s + r.debit, 0),
            },
            {
              label: 'Credits',
              value: data.rows.reduce((s, r) => s + r.credit, 0),
            },
            { label: 'Closing', value: data.closingBalance },
          ]
        : [],
    [data],
  );

  const period =
    from && to
      ? `${asDate(from)} to ${asDate(to)}`
      : from
        ? `from ${asDate(from)}`
        : to
          ? `to ${asDate(to)}`
          : 'All dates';

  const spec: ReportSpec = {
    companyName,
    subtitle: data
      ? `Statement of Account - ${data.party.name} - ${period}`
      : 'Statement of Account',
    columns: selected.columns,
    weights: selected.weights,
    blocks,
    fileBase: 'statement-of-account',
    summary,
    numericCols: selected.numericCols,
  };

  const has = !!data?.rows.length;
  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Statement of Account"
        description="One party's ledger in the order it happened, with what each entry was against"
        icon={<BookOpen className="h-5 w-5" />}
        actions={
          <ReportExportButtons
            canPrint={canPrint}
            canPdf={can(ROUTE, 'downloadPdf')}
            canExcel={can(ROUTE, 'downloadExcel')}
            onPreview={() => {
              if (!printReport(spec, { allowPrint: canPrint })) popupBlocked();
            }}
            onPrint={() => {
              if (!printReport(spec, { autoPrint: true })) popupBlocked();
            }}
            onPdf={() => pdfReport(spec)}
            onExcel={() => excelReport(spec, { sectionLabel: 'Party' })}
            disabled={!has}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select
            value={partyKind}
            onChange={(e) => {
              setPartyKind(e.target.value as 'CUSTOMER' | 'SUPPLIER');
              // The party list is drawn from the kind; one held over would ask
              // for a customer's statement out of the supplier ledger.
              setPartyId('');
            }}
            options={[
              { value: 'CUSTOMER', label: 'Customers' },
              { value: 'SUPPLIER', label: 'Suppliers' },
            ]}
            className="w-40"
          />
          <Select
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
            options={(parties ?? []).map((p) => ({
              value: String(p.id),
              label: `${p.code} · ${p.name}`,
            }))}
            placeholder="Choose a party"
            className="w-72"
          />
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-40"
          />
          <div className="ml-auto flex items-center gap-2">
            <ColumnToggle
              columns={ALL_COLUMNS.map((c) => ({
                key: c.key,
                label: c.header,
              }))}
              hidden={hidden}
              onToggle={toggle}
            />
            {data && (
              <span className="text-sm text-slate-500 dark:text-slate-400">
                Closing {money(Math.abs(data.closingBalance))}{' '}
                {data.closingBalance >= 0 ? 'Dr' : 'Cr'}
              </span>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={selected.columns}
            weights={selected.weights}
            blocks={blocks}
            loading={loading}
            darkCol={selected.darkCol}
            statusCol={selected.statusCol}
            emptyText={
              partyId
                ? 'Nothing posted to this party in that period.'
                : 'Choose a party to see their statement.'
            }
          />
        </div>
      </div>
    </div>
  );
}
