'use client';

import { useMemo, useState } from 'react';
import { Hourglass } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Input, Select } from '@/components/ui/Field';
import { ReportView, ReportExportButtons } from '@/components/ui/ReportView';
import {
  printReport,
  pdfReport,
  excelReport,
  resolveCompanyName,
  type ReportBlock,
  type ReportSpec,
} from '@/lib/reportDoc';
import type { AgeingReport, Company, PartyLite } from '@/lib/types';

const ROUTE = '/accounts/reports/bill-ageing';

const money = (n: number) =>
  n
    ? n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '';
const asDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : '';

/**
 * Bill ageing — every bill still standing, by how long it has been overdue.
 *
 * Aged by DUE date rather than bill date: a bill on 60-day terms raised 45 days
 * ago is not late, and a report that called it late would have people chasing
 * parties who are inside their agreed terms.
 *
 * Two views of the same figures. SUMMARY is one row per party across the
 * buckets — who to chase. DETAIL opens each party's bills — what to chase them
 * about.
 */
export default function BillAgeingPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();

  const [partyKind, setPartyKind] = useState<'CUSTOMER' | 'SUPPLIER'>(
    'CUSTOMER',
  );
  const [partyId, setPartyId] = useState('');
  const [asOn, setAsOn] = useState(new Date().toISOString().slice(0, 10));
  const [detail, setDetail] = useState(false);

  const { data: parties } = useFetch<PartyLite[]>(
    `/party-ledger/parties?partyKind=${partyKind}`,
    [partyKind],
  );
  const { data: companies } = useFetch<Company[]>('/companies');

  const query = [
    `partyKind=${partyKind}`,
    asOn ? `asOn=${asOn}` : '',
    partyId ? `partyId=${partyId}` : '',
  ]
    .filter(Boolean)
    .join('&');
  const { data, loading } = useFetch<AgeingReport>(
    `/party-ledger/ageing?${query}`,
    [query],
  );

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  // Columns follow the buckets the server declares, so adding a bucket there
  // does not need a second edit here.
  const { columns, weights, numericCols } = useMemo(() => {
    const bucketCols = data?.buckets ?? [];
    return {
      columns: detail
        ? ['Bill', 'Date', 'Due', 'Bucket', 'Overdue', 'Amount', 'Pending']
        : ['Party', ...bucketCols, 'Total'],
      weights: detail
        ? [18, 12, 12, 16, 10, 16, 16]
        : [26, ...bucketCols.map(() => 12), 14],
      numericCols: detail
        ? [4, 5, 6]
        : bucketCols.map((_, i) => i + 1).concat([bucketCols.length + 1]),
    };
  }, [data, detail]);

  const blocks = useMemo(() => {
    if (!data?.parties.length) return [] as ReportBlock[];
    if (detail) {
      return data.parties.map((p) => ({
        section: `${p.code} · ${p.name}`,
        heading: `${money(p.total)} outstanding${
          p.creditDays != null ? ` · ${p.creditDays} days credit` : ''
        }`,
        count: p.bills.length,
        tables: [
          {
            rows: p.bills.map((b) => [
              b.billRef ?? '—',
              asDate(b.date),
              asDate(b.dueDate),
              b.bucket,
              b.overdueDays > 0 ? `${b.overdueDays}d` : '',
              money(b.amount),
              money(b.pending),
            ]),
          },
        ],
      }));
    }
    return [
      {
        section: partyKind === 'CUSTOMER' ? 'Receivable' : 'Payable',
        heading: `Outstanding as at ${asDate(data.asOn)}`,
        count: data.parties.length,
        tables: [
          {
            rows: [
              ...data.parties.map((p) => [
                `${p.code} · ${p.name}`,
                ...p.buckets.map(money),
                money(p.total),
              ]),
              ['Total', ...data.totals.map(money), money(data.grandTotal)],
            ],
            // The total row reads as a heading, not as another party.
            shade: [...data.parties.map(() => false), true],
          },
        ],
      },
    ];
  }, [data, detail, partyKind]);

  const summary = useMemo(() => {
    if (!data) return [];
    return [
      { label: 'Parties', value: data.parties.length },
      ...data.buckets.map((b, i) => ({ label: b, value: data.totals[i] })),
      { label: 'Total', value: data.grandTotal },
    ];
  }, [data]);

  const spec: ReportSpec = {
    companyName,
    subtitle: `Bill Ageing - ${partyKind === 'CUSTOMER' ? 'Receivable' : 'Payable'} as at ${asDate(asOn)}`,
    columns,
    weights,
    blocks,
    fileBase: 'bill-ageing',
    summary,
    numericCols,
  };

  const has = !!data?.parties.length;
  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Bill Ageing"
        description="Bills still standing, by how far past their due date they are"
        icon={<Hourglass className="h-5 w-5" />}
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
              setPartyId('');
            }}
            options={[
              { value: 'CUSTOMER', label: 'Receivable (customers)' },
              { value: 'SUPPLIER', label: 'Payable (suppliers)' },
            ]}
            className="w-56"
          />
          <Select
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
            options={(parties ?? []).map((p) => ({
              value: String(p.id),
              label: `${p.code} · ${p.name}`,
            }))}
            placeholder="All parties"
            className="w-64"
          />
          <Input
            type="date"
            value={asOn}
            onChange={(e) => setAsOn(e.target.value)}
            className="w-40"
          />
          <Select
            value={detail ? 'detail' : 'summary'}
            onChange={(e) => setDetail(e.target.value === 'detail')}
            options={[
              { value: 'summary', label: 'Summary by party' },
              { value: 'detail', label: 'Bill by bill' },
            ]}
            className="w-48"
          />
          <div className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {data ? `${money(data.grandTotal) || '0.00'} outstanding` : ''}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={columns}
            weights={weights}
            blocks={blocks}
            loading={loading}
            collapsible={detail}
            emptyText="Nothing outstanding as at that date."
          />
        </div>
      </div>
    </div>
  );
}
