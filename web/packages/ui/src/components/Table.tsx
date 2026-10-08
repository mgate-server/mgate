import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: ReactNode;
  isLoading?: boolean;
  className?: string;
}

/** Minimal generic data table. TODO(S4): sorting/pagination once list endpoints exist. */
export function Table<T>({ columns, rows, rowKey, emptyMessage, isLoading, className }: TableProps<T>) {
  return (
    <div className={cn('border-mg-border overflow-x-auto rounded-lg border', className)}>
      <table className="w-full min-w-max text-left text-sm">
        <thead className="bg-mg-surface-raised text-mg-text-muted">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={cn('px-3 py-2 font-medium', col.className)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-mg-border divide-y">
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className="text-mg-text-muted px-3 py-8 text-center">
                Загрузка…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-mg-text-muted px-3 py-8 text-center">
                {emptyMessage ?? '—'}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="text-mg-text">
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-3 py-2', col.className)}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
