'use client';

import { useMemo, useState } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { RowActions } from './RowActions';

export interface Column<T> {
  key: string;
  header: string;
  /** custom cell renderer */
  render?: (row: T) => React.ReactNode;
  /** accessor for default rendering / client-side search */
  accessor?: (row: T) => string | number | null | undefined;
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;

  // search
  search?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  /** if true, the search box only triggers onSearchChange (server-side). Otherwise filters client-side. */
  serverSearch?: boolean;

  // actions
  onView?: (row: T) => void;
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
  canView?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  /** Extra secondary actions, rendered to the LEFT of View/Edit/Delete/Lock. */
  rowActions?: (row: T) => React.ReactNode;
  /**
   * Lock/unlock toggle, rendered LAST (after Delete). Pass the Lock here — not
   * in rowActions — so every listing keeps the standard
   * View, Edit, Delete, Lock order.
   */
  renderLock?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;

  // toolbar
  toolbar?: React.ReactNode;
  /** rendered in the right cluster, just after the search box */
  toolbarRight?: React.ReactNode;
  onRefresh?: () => void;

  // pagination
  pageSize?: number;
  /** server-side pagination control. If provided, client pagination is disabled. */
  serverPagination?: {
    page: number;
    total: number;
    pageSize: number;
    onPageChange: (page: number) => void;
  };

  emptyMessage?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  search,
  onSearchChange,
  searchPlaceholder = 'Search...',
  serverSearch,
  onView,
  onEdit,
  onDelete,
  canView = true,
  canEdit = true,
  canDelete = true,
  rowActions,
  renderLock,
  onRowClick,
  toolbar,
  toolbarRight,
  onRefresh,
  pageSize = 10,
  serverPagination,
  emptyMessage = 'No records found',
}: DataTableProps<T>) {
  const [internalSearch, setInternalSearch] = useState('');
  const [page, setPage] = useState(1);

  const searchValue = onSearchChange ? (search ?? '') : internalSearch;
  const setSearchValue = (v: string) => {
    if (onSearchChange) onSearchChange(v);
    else setInternalSearch(v);
    if (!serverPagination) setPage(1);
  };

  const hasActions =
    !!onView || !!onEdit || !!onDelete || !!rowActions || !!renderLock;

  // Client-side filtering (only when not in serverSearch mode)
  const filtered = useMemo(() => {
    if (serverSearch || !searchValue.trim()) return rows;
    const q = searchValue.toLowerCase();
    return rows.filter((row) =>
      columns.some((c) => {
        const val = c.accessor
          ? c.accessor(row)
          : (row as any)[c.key];
        return val != null && String(val).toLowerCase().includes(q);
      }),
    );
  }, [rows, columns, searchValue, serverSearch]);

  // Pagination
  const total = serverPagination ? serverPagination.total : filtered.length;
  const effPageSize = serverPagination ? serverPagination.pageSize : pageSize;
  const currentPage = serverPagination ? serverPagination.page : page;
  const totalPages = Math.max(1, Math.ceil(total / effPageSize));

  const pageRows = useMemo(() => {
    if (serverPagination) return filtered;
    const start = (currentPage - 1) * effPageSize;
    return filtered.slice(start, start + effPageSize);
  }, [filtered, currentPage, effPageSize, serverPagination]);

  const goTo = (p: number) => {
    const clamped = Math.min(Math.max(1, p), totalPages);
    if (serverPagination) serverPagination.onPageChange(clamped);
    else setPage(clamped);
  };

  const from = total === 0 ? 0 : (currentPage - 1) * effPageSize + 1;
  const to = Math.min(currentPage * effPageSize, total);

  return (
    <div className="card overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">{toolbar}</div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={searchPlaceholder}
              className="input-base w-56 pl-9"
            />
          </div>
          {toolbarRight}
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="btn-secondary px-2.5"
              title="Refresh"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn('px-4 py-3', c.headerClassName)}
                >
                  {c.header}
                </th>
              ))}
              {hasActions && (
                <th className="px-4 py-3 text-right">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length + (hasActions ? 1 : 0)}
                  className="px-4 py-12 text-center text-slate-400"
                >
                  <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" />
                  Loading...
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (hasActions ? 1 : 0)}
                  className="px-4 py-14 text-center text-slate-400"
                >
                  <Inbox className="mx-auto mb-2 h-8 w-8 opacity-60" />
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-slate-100 transition last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40',
                    onRowClick && 'cursor-pointer',
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        'px-4 py-3 text-slate-700 dark:text-slate-300',
                        c.className,
                      )}
                    >
                      {c.render
                        ? c.render(row)
                        : c.accessor
                          ? (c.accessor(row) ?? '-')
                          : ((row as any)[c.key] ?? '-')}
                    </td>
                  ))}
                  {hasActions && (
                    <td className="px-4 py-3">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <RowActions
                          before={rowActions?.(row)}
                          onView={onView ? () => onView(row) : undefined}
                          onEdit={onEdit ? () => onEdit(row) : undefined}
                          onDelete={onDelete ? () => onDelete(row) : undefined}
                          canView={canView}
                          canEdit={canEdit}
                          canDelete={canDelete}
                          lock={renderLock?.(row)}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:flex-row">
        <span>
          {total === 0
            ? 'No records'
            : `Showing ${from}-${to} of ${total} records`}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => goTo(currentPage - 1)}
            disabled={currentPage <= 1}
            className="btn-secondary px-2 py-1.5 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-2">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => goTo(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="btn-secondary px-2 py-1.5 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
