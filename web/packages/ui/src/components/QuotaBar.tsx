import { cn } from '../cn';

export interface QuotaBarProps {
  usedBytes: number;
  totalBytes: number;
  label?: string;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exp;
  return `${value >= 10 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
}

/** Storage/mailbox quota indicator; also used for domain-level mailbox count quotas. */
export function QuotaBar({ usedBytes, totalBytes, label, className }: QuotaBarProps) {
  const ratio = totalBytes > 0 ? Math.min(usedBytes / totalBytes, 1) : 0;
  const percent = Math.round(ratio * 100);
  const tone = ratio >= 0.9 ? 'bg-mg-danger' : ratio >= 0.75 ? 'bg-mg-warning' : 'bg-mg-primary';

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label ? <span className="text-mg-text-muted text-sm">{label}</span> : null}
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="bg-mg-border h-2 w-full overflow-hidden rounded-full"
      >
        <div
          className={cn('h-full rounded-full transition-all', tone)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-mg-text-muted text-xs">
        {formatBytes(usedBytes)} / {formatBytes(totalBytes)} ({percent}%)
      </span>
    </div>
  );
}
