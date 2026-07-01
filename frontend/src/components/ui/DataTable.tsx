'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { RowActions } from './RowActions';
import { ColumnToggle } from './ColumnToggle';

export interface Column<T> {
  key: string;
  header: string;
  /** custom cell renderer */
  render?: (row: T) => React.ReactNode;
  /** accessor for default rendering / client-side search */
  accessor?: (row: T) => string | number | null | undefined;
  /**
   * Make the header clickable to sort. Defaults to on for any column that has
   * an `accessor` or `sortAccessor`; pass `false` to opt a column out.
   */
  sortable?: boolean;
  /** Value used when sorting this column (falls back to accessor / key). */
  sortAccessor?: (row: T) => string | number | null | undefined;
  className?: string;
  headerClassName?: string;
}

export type SortState = { key: string; dir: 'asc' | 'desc' };

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
  /** Extra classes per row (e.g. to highlight a category of rows). */
  rowClassName?: (row: T) => string | undefined;

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
  /**
   * Server-side sort control. Provide this to keep sortable headers even under
   * server pagination — clicking a header calls `onSortChange` (the parent
   * re-fetches sorted) instead of sorting the current page slice.
   */
  serverSort?: {
    sort: SortState | null;
    onSortChange: (sort: SortState) => void;
  };

  emptyMessage?: string;

  /** Initial sort for sortable columns (client-side sort only). */
  defaultSort?: SortState;

  /** Show the show/hide-columns control (on by default). */
  columnToggle?: boolean;
  /**
   * Storage key for remembering hidden columns. Defaults to the current route,
   * so each listing keeps its own column preferences.
   */
  tableId?: string;

  /**
   * Fill the parent's height and scroll only the table body, keeping the
   * toolbar, column headers and pagination frozen. The page must give the table
   * a bounded height (e.g. an `h-full` flex column).
   */
  fillHeight?: boolean;
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
  rowClassName,
  toolbar,
  toolbarRight,
  onRefresh,
  pageSize = 10,
  serverPagination,
  serverSort,
  emptyMessage = 'No records found',
  defaultSort,
  columnToggle = true,
  tableId,
  // Frozen header is the standard for listing screens. The page should give the
  // table a bounded height (an `h-full` flex column); without one it degrades to
  // a normally-scrolling table. Pass `fillHeight={false}` to opt out.
  fillHeight = true,
}: DataTableProps<T>) {
  const [internalSearch, setInternalSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortState, setSortState] = useState<SortState | null>(
    defaultSort ?? null,
  );

  // The effective sort comes from the parent in server-sort mode, else local.
  const activeSort = serverSort ? serverSort.sort : sortState;
  const toggleSort = (key: string) => {
    const cur = activeSort;
    const next: SortState =
      cur?.key === key
        ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' };
    if (serverSort) {
      serverSort.onSortChange(next);
    } else {
      setSortState(next);
      if (!serverPagination) setPage(1);
    }
  };

  // Hidden columns, remembered per listing (keyed by tableId or the route).
  const pathname = usePathname();
  const storageKey = `datatable.hiddenColumns.${tableId ?? pathname ?? ''}`;
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setHiddenCols(raw ? new Set(JSON.parse(raw) as string[]) : new Set());
    } catch {
      setHiddenCols(new Set());
    }
  }, [storageKey]);
  const toggleColumn = (key: string) =>
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        // Keep at least one column visible.
        if (columns.length - next.size <= 1) return prev;
        next.add(key);
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenCols.has(c.key)),
    [columns, hiddenCols],
  );
  const showColumnToggle = columnToggle && columns.length > 1;

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

  // Client-side sort (skipped in server-pagination mode, where the page only
  // holds a slice of the data).
  const sorted = useMemo(() => {
    if (serverPagination || !sortState) return filtered;
    const col = columns.find((c) => c.key === sortState.key);
    if (!col) return filtered;
    const valueOf = (row: T) =>
      col.sortAccessor
        ? col.sortAccessor(row)
        : col.accessor
          ? col.accessor(row)
          : (row as any)[col.key];
    const dir = sortState.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // nulls/blanks last regardless of direction
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * dir;
      }
      return (
        String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir
      );
    });
  }, [filtered, sortState, columns, serverPagination]);

  // Pagination
  const total = serverPagination ? serverPagination.total : sorted.length;
  const effPageSize = serverPagination ? serverPagination.pageSize : pageSize;
  const currentPage = serverPagination ? serverPagination.page : page;
  const totalPages = Math.max(1, Math.ceil(total / effPageSize));

  const pageRows = useMemo(() => {
    if (serverPagination) return sorted;
    const start = (currentPage - 1) * effPageSize;
    return sorted.slice(start, start + effPageSize);
  }, [sorted, currentPage, effPageSize, serverPagination]);

  const goTo = (p: number) => {
    const clamped = Math.min(Math.max(1, p), totalPages);
    if (serverPagination) serverPagination.onPageChange(clamped);
    else setPage(clamped);
  };

  const from = total === 0 ? 0 : (currentPage - 1) * effPageSize + 1;
  const to = Math.min(currentPage * effPageSize, total);

  return (
    <div
      className={cn(
        'card overflow-hidden',
        fillHeight && 'flex min-h-0 flex-1 flex-col',
      )}
    >
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
          {showColumnToggle && (
            <ColumnToggle
              columns={columns.map((c) => ({ key: c.key, label: c.header }))}
              hidden={hiddenCols}
              onToggle={toggleColumn}
            />
          )}
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
      <div
        className={cn(
          'overflow-x-auto',
          fillHeight && 'min-h-0 flex-1 overflow-y-auto',
        )}
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[#efe7db] bg-[#fcfbf8] text-xs font-semibold uppercase tracking-wide text-[#6d6258] dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              {visibleColumns.map((c) => {
                const sortable =
                  (c.sortable ?? (!!c.accessor || !!c.sortAccessor)) &&
                  (!serverPagination || !!serverSort);
                const active = activeSort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    className={cn(
                      'px-4 py-3',
                      fillHeight &&
                        'sticky top-0 z-10 bg-[#fcfbf8] dark:bg-slate-900',
                      c.headerClassName,
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={cn(
                          'inline-flex items-center gap-1 transition hover:text-slate-700 dark:hover:text-slate-200',
                          active && 'text-slate-700 dark:text-slate-200',
                        )}
                        title={`Sort by ${c.header}`}
                      >
                        {c.header}
                        {active ? (
                          activeSort!.dir === 'asc' ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {hasActions && (
                <th
                  className={cn(
                    'px-4 py-3 text-right',
                    fillHeight &&
                      'sticky top-0 z-10 bg-[#fcfbf8] dark:bg-slate-900',
                  )}
                >
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (hasActions ? 1 : 0)}
                  className="px-4 py-12 text-center text-slate-400"
                >
                  <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" />
                  Loading...
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (hasActions ? 1 : 0)}
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
                    rowClassName?.(row),
                  )}
                >
                  {visibleColumns.map((c) => (
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
