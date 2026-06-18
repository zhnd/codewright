import { cn } from '@/utils/cn';

interface DotProps {
  color?: string;
  size?: number;
  pulse?: boolean;
  className?: string;
}

/**
 * Base status-dot primitive. Use `color` for arbitrary CSS color, or
 * `className` to style via the `.sv-*` semantic classes in globals.css.
 */
export function Dot({
  color = 'var(--foreground-subtle)',
  size = 6,
  pulse = false,
  className,
}: DotProps) {
  return (
    <span
      style={{ width: size, height: size }}
      className="relative inline-block shrink-0"
    >
      <span
        className={cn('block rounded-full', className)}
        style={{
          width: size,
          height: size,
          background: className ? undefined : color,
        }}
      />
      {pulse && (
        <span
          className={cn(
            'codewright-ping absolute inset-0 rounded-full opacity-45',
            className
          )}
          style={{ background: className ? undefined : color }}
        />
      )}
    </span>
  );
}
