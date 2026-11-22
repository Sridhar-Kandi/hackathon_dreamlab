import {
  type ColumnDef, type RowSelectionState, type SortingState, flexRender, getCoreRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  getRowId: (row: T) => string
  selectable?: boolean
  rowSelection?: RowSelectionState
  onRowSelectionChange?: (selection: RowSelectionState) => void
  onRowClick?: (row: T) => void
  pageSize?: number
  empty?: string
  initialSorting?: SortingState
}

export function SortHeader({ label, column }: { label: string; column: { getIsSorted: () => false | "asc" | "desc"; toggleSorting: (desc?: boolean) => void } }) {
  const sorted = column.getIsSorted()
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-foreground"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      <Icon className={cn("size-3", sorted ? "text-foreground" : "text-muted-foreground/60")} />
    </button>
  )
}

export function DataTable<T>({
  columns, data, getRowId, selectable = false, rowSelection, onRowSelectionChange, onRowClick, pageSize = 15,
  empty = "No rows.", initialSorting = [],
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  const [localSelection, setLocalSelection] = useState<RowSelectionState>({})
  const selection = rowSelection ?? localSelection

  const selectColumn: ColumnDef<T, unknown> = {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all rows on this page"
        checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label="Select row"
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
      />
    ),
    enableSorting: false,
    size: 32,
  }

  const table = useReactTable({
    data,
    columns: selectable ? [selectColumn, ...columns] : columns,
    getRowId,
    state: { sorting, rowSelection: selection },
    onSortingChange: setSorting,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(selection) : updater
      if (onRowSelectionChange) onRowSelectionChange(next)
      else setLocalSelection(next)
    },
    enableRowSelection: selectable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    autoResetPageIndex: false,
  })

  const { pageIndex } = table.getState().pagination
  const rows = table.getRowModel().rows
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table className="text-[13px]">
        <TableHeader className="bg-background">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <TableHead key={header.id} className="h-9 px-3 text-[12px] font-semibold text-muted-foreground"
                  style={header.column.columnDef.size ? { width: header.column.columnDef.size } : undefined}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length ? rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={row.getIsSelected() ? "selected" : undefined}
              className={cn("data-[state=selected]:bg-accent", onRowClick && "cursor-pointer")}
              onClick={() => onRowClick?.(row.original)}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="px-3 py-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          )) : (
            <TableRow>
              <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between border-t px-3 py-2 text-[12px] text-muted-foreground">
        <span>
          {selectable && Object.keys(selection).length > 0 ? `${Object.keys(selection).length} selected · ` : ""}
          {data.length} {data.length === 1 ? "item" : "items"}
        </span>
        <div className="flex items-center gap-2">
          <span>Page {table.getPageCount() ? pageIndex + 1 : 0} of {table.getPageCount()}</span>
          <Button variant="outline" size="icon" className="size-7" aria-label="Previous page"
            disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon" className="size-7" aria-label="Next page"
            disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
