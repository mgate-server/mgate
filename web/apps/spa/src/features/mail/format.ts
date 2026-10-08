/** Human-readable byte size (binary units, one decimal for KB and above). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Date column of the message list: time for today, short date otherwise. */
export function formatMailDate(dateStr: string, now: Date = new Date()): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (d.getFullYear() !== now.getFullYear()) {
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
