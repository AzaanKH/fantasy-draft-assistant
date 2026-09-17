/**
 * Generic DataTable Component
 *
 * Built with TanStack Table and shadcn/ui Table components.
 * Supports sorting, filtering, and row click handling.
 */

import * as React from 'react';
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DEFAULT_SORTING: SortingState = [{ id: 'ecrRank', desc: false }];

function getStickyColumnClass(columnId: string, isHeader: boolean): string {
  if (columnId === 'name') {
    return cn(
      'sticky left-0 shadow-[6px_0_8px_-8px_rgba(0,0,0,0.35)]',
      isHeader ? 'z-30 bg-muted' : 'z-10 bg-card'
    );
  }
  if (columnId === 'actions') {
    return cn(
      'sticky right-0 shadow-[-6px_0_8px_-8px_rgba(0,0,0,0.35)]',
      isHeader ? 'z-30 bg-muted' : 'z-10 bg-card'
    );
  }
  return '';
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  onRowClick?: (row: TData) => void;
  getRowClassName?: (row: TData) => string;
  getRowGroupLabel?: (row: TData, previousRow: TData | undefined) => React.ReactNode;
  filterColumn?: string;
  filterValue?: string;
  columnFilters?: ColumnFiltersState;
  pageSize?: number;
  initialSorting?: SortingState;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  onRowClick,
  getRowClassName,
  getRowGroupLabel,
  columnFilters: externalFilters,
  pageSize = 50,
  initialSorting = DEFAULT_SORTING,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    externalFilters ?? []
  );
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});

  // Sync external filters
  React.useEffect(() => {
    if (externalFilters) {
      setColumnFilters(externalFilters);
    }
  }, [externalFilters]);

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
    },
    initialState: {
      pagination: {
        pageSize,
      },
    },
  });

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-lg border border-border/70">
        <Table>
          <TableHeader className="bg-muted/25">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    scope="col"
                    className={cn(
                      'h-9 whitespace-nowrap px-3 text-xs',
                      getStickyColumnClass(header.column.id, true)
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row, index, rows) => {
                const previousRow = rows[index - 1];
                const groupLabel = getRowGroupLabel?.(
                  row.original,
                  previousRow?.original
                );

                return (
                  <React.Fragment key={row.id}>
                    {groupLabel && (
                      <TableRow className="border-y border-border/70 bg-muted/40 hover:bg-muted/40">
                        <TableCell
                          colSpan={row.getVisibleCells().length}
                          className="px-3 py-2"
                        >
                          {groupLabel}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow
                      data-state={row.getIsSelected() && 'selected'}
                      className={cn(
                        onRowClick && 'cursor-pointer',
                        getRowClassName?.(row.original)
                      )}
                      onClick={() => onRowClick?.(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            'px-3 py-3',
                            getStickyColumnClass(cell.column.id, false)
                          )}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  </React.Fragment>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No players found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-muted-foreground text-sm">
          Showing {table.getRowModel().rows.length} of{' '}
          {table.getFilteredRowModel().rows.length} players
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { table.previousPage(); }}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of{' '}
            {table.getPageCount()}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { table.nextPage(); }}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
