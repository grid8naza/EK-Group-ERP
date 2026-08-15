'use client';

import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { formatDayMonthYear } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Field';
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
import type { Company, Employee, HrDesignation } from '@/lib/types';

const ROUTE = '/hr/reports/employees';

const NO_DIVISION = '— No division —';
const NO_DEPARTMENT = '— No department —';

/**
 * The staff register: everybody on the books, grouped the way the company is
 * organised — division, then department.
 *
 * Grouped rather than flat because that is the question it is usually opened
 * with ("who is in Packing?"), and because a flat list of several hundred names
 * is a list nobody reads. The grouping mirrors the Employee form's own Division
 * → Department, which comes from the company's cost centres and objects.
 */
export default function EmployeeListReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<Employee[]>('/hr-employees');
  const { data: designations } = useFetch<HrDesignation[]>('/hr-designations');
  const { data: companies } = useFetch<Company[]>('/companies');

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  const allColumns = useMemo<ReportColumn<Employee>[]>(
    () => [
      { key: 'code', header: 'Emp. ID', weight: 10, cell: (e) => e.code },
      {
        key: 'name',
        header: 'Name',
        weight: 18,
        bold: true,
        cell: (e) => e.name,
      },
      {
        key: 'designation',
        header: 'Designation',
        weight: 15,
        cell: (e) => e.designationName ?? '-',
      },
      {
        key: 'grade',
        header: 'Grade',
        weight: 6,
        cell: (e) => e.gradeName ?? '-',
      },
      {
        key: 'category',
        header: 'Category',
        weight: 11,
        cell: (e) => e.categoryName ?? '-',
      },
      {
        key: 'doj',
        header: 'Joined',
        weight: 9,
        center: true,
        cell: (e) => formatDayMonthYear(e.dateOfJoin),
      },
      {
        key: 'confirmed',
        header: 'Confirmed',
        weight: 9,
        center: true,
        cell: (e) => formatDayMonthYear(e.dateOfConfirmation),
      },
      {
        key: 'phone',
        header: 'Contact',
        weight: 11,
        center: true,
        cell: (e) => e.phone ?? '-',
      },
      {
        key: 'reportsTo',
        header: 'Reports To',
        weight: 13,
        cell: (e) => e.reportsToName ?? '-',
      },
      {
        key: 'status',
        header: 'Status',
        weight: 8,
        status: true,
        cell: (e) => (e.isActive ? 'Active' : 'Inactive'),
      },
    ],
    [],
  );

  const { hidden, toggle, selected } = useReportColumns(ROUTE, allColumns);

  const [designationFilter, setDesignationFilter] = useState('');
  const [status, setStatus] = useState('active');

  // Division → Department → people, each sorted by name.
  const blocks = useMemo<ReportBlock[]>(() => {
    let rows = data ?? [];
    if (designationFilter) {
      rows = rows.filter((r) => String(r.designationId) === designationFilter);
    }
    if (status) rows = rows.filter((r) => r.isActive === (status === 'active'));

    const byDivision = new Map<string, Map<string, Employee[]>>();
    for (const e of rows) {
      const div = e.divisionName ?? NO_DIVISION;
      const dept = e.departmentName ?? NO_DEPARTMENT;
      if (!byDivision.has(div)) byDivision.set(div, new Map());
      const d = byDivision.get(div)!;
      if (!d.has(dept)) d.set(dept, []);
      d.get(dept)!.push(e);
    }

    return [...byDivision.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([divisionName, deptMap]) => {
        const tables = [...deptMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([deptName, people]) => ({
            subheading: deptName,
            subcount: people.length,
            rows: [...people]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(selected.cells),
          }));
        return {
          heading: divisionName,
          count: tables.reduce((n, t) => n + t.rows.length, 0),
          tables,
        };
      });
  }, [data, designationFilter, status, selected]);

  const total = blocks.reduce((n, b) => n + (b.count ?? 0), 0);

  const summary = useMemo(
    () => [
      { label: 'Divisions', value: blocks.length },
      {
        label: 'Departments',
        value: blocks.reduce((n, b) => n + b.tables.length, 0),
      },
      { label: 'Total Employees', value: total },
    ],
    [blocks, total],
  );

  const spec: ReportSpec = {
    companyName,
    subtitle: `Employee List - ${total} ${total === 1 ? 'employee' : 'employees'}`,
    columns: selected.columns,
    weights: selected.weights,
    blocks,
    centerCols: selected.centerCols,
    fileBase: 'employee-list-report',
    serial: true,
    summary,
  };

  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');
  const onPreview = () => {
    if (!printReport(spec, { allowPrint: canPrint })) popupBlocked();
  };
  const onPrint = () => {
    if (!printReport(spec, { autoPrint: true })) popupBlocked();
  };

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Employee List"
        description="Staff grouped by division and department, with print and export"
        icon={<Users className="h-5 w-5" />}
        actions={
          <ReportExportButtons
            canPrint={canPrint}
            canPdf={can(ROUTE, 'downloadPdf')}
            canExcel={can(ROUTE, 'downloadExcel')}
            onPreview={onPreview}
            onPrint={onPrint}
            onPdf={() => pdfReport(spec)}
            onExcel={() =>
              excelReport(spec, {
                headingLabel: 'Division',
                subheadingLabel: 'Department',
              })
            }
            disabled={total === 0}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select
            value={designationFilter}
            onChange={(e) => setDesignationFilter(e.target.value)}
            wrapClassName="w-56"
            placeholder="All designations"
            options={(designations ?? []).map((d) => ({
              value: String(d.id),
              label: d.name,
            }))}
          />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            wrapClassName="w-40"
            placeholder="Active & inactive"
            sortOptions={false}
            options={[
              { value: 'active', label: 'Active only' },
              { value: 'inactive', label: 'Inactive only' },
            ]}
          />
          <div className="ml-auto flex items-center gap-2">
            <ColumnToggle
              columns={allColumns.map((c) => ({ key: c.key, label: c.header }))}
              hidden={hidden}
              onToggle={toggle}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {total} employee{total === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={selected.columns}
            weights={selected.weights}
            blocks={blocks}
            loading={loading}
            statusCol={selected.statusCol}
            boldCol={selected.boldCol}
            centerCols={selected.centerCols}
            serial
            summary={summary}
            emptyText="No employees match the current filters."
          />
        </div>
      </div>
    </div>
  );
}
