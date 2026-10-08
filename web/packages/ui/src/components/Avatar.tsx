import { cn } from '../cn';

export interface AvatarProps {
  name?: string | null;
  email?: string | null;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const BG_COLORS = [
  'bg-blue-600 text-white',
  'bg-emerald-600 text-white',
  'bg-indigo-600 text-white',
  'bg-amber-600 text-white',
  'bg-rose-600 text-white',
  'bg-purple-600 text-white',
  'bg-cyan-600 text-white',
  'bg-teal-600 text-white',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInitials(name?: string | null, email?: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0] ?? '';
    const second = parts[1] ?? '';
    if (first && second) {
      return (first[0]! + second[0]!).toUpperCase();
    }
    if (first) {
      return first.slice(0, 2).toUpperCase();
    }
  }
  if (email && email.trim()) {
    const local = email.split('@')[0] ?? '';
    if (local) {
      return local.slice(0, 2).toUpperCase();
    }
  }
  return '?';
}

export function Avatar({ name, email, src, size = 'md', className }: AvatarProps) {
  const identifier = email || name || 'default';
  const colorIndex = hashString(identifier) % BG_COLORS.length;
  const colorClass = BG_COLORS[colorIndex];
  const initials = getInitials(name, email);

  const sizeClasses = {
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm font-medium',
    lg: 'h-12 w-12 text-base font-semibold',
  }[size];

  if (src) {
    return (
      <img
        src={src}
        alt={name || email || 'Avatar'}
        className={cn('shrink-0 rounded-full object-cover', sizeClasses, className)}
      />
    );
  }

  return (
    <div
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full shadow-xs',
        colorClass,
        sizeClasses,
        className,
      )}
      title={name || email || undefined}
    >
      {initials}
    </div>
  );
}
