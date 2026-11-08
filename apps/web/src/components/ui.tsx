import clsx from 'clsx';
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';

// ── Button ─────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass';
type Size = 'sm' | 'md' | 'lg';

export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', extra?: string) {
  return clsx(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-all duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:size-4',
    {
      primary: 'bg-brand-600 text-white shadow-sm shadow-brand-900/10 hover:bg-brand-700',
      secondary: 'border border-slate-200 bg-white text-slate-800 shadow-sm hover:border-slate-300 hover:bg-slate-50',
      ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700',
      glass: 'bg-white/10 text-white backdrop-blur hover:bg-white/20 focus-visible:ring-offset-0',
    }[variant],
    { sm: 'h-8 px-3 text-[13px]', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-[15px]' }[size],
    extra,
  );
}

export function Button({
  variant,
  size,
  loading,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button type={type} className={buttonClasses(variant, size, className)} disabled={disabled || loading} {...props}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

// ── Surfaces ───────────────────────────────────────────────────────

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.08)]', className)}
      {...props}
    />
  );
}

type Tone = 'neutral' | 'brand' | 'amber' | 'rose' | 'sky' | 'violet';
const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  brand: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200/60',
  amber: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200/70',
  rose: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200/70',
  sky: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200/70',
  violet: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200/70',
};

export function Badge({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium [&_svg]:size-3', tones[tone], className)}>
      {children}
    </span>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#1c7e69', '#4f46e5', '#b45309', '#0369a1', '#be185d', '#7c3aed', '#0f766e', '#c2410c'];

export function initials(name: string) {
  const parts = name.replace(/^Dr\.?\s+/i, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

function colorFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({
  name,
  color,
  size = 'md',
  className,
}: {
  name: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const c = color ?? colorFor(name);
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold tracking-tight select-none',
        { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg', xl: 'size-24 text-3xl' }[size],
        className,
      )}
      style={{ backgroundColor: `${c}1f`, color: c }}
    >
      {initials(name)}
    </span>
  );
}

// ── Forms ──────────────────────────────────────────────────────────

const fieldBase =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] text-slate-900 shadow-sm transition placeholder:text-slate-400 ' +
  'focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:bg-slate-50';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(fieldBase, 'h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(fieldBase, 'min-h-28 resize-y py-3 leading-relaxed', className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  optional,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-slate-700">
        {label}
        {optional && <span className="text-xs font-normal text-slate-400">Optional</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('size-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Alert({ tone = 'rose', children, className }: { tone?: 'rose' | 'amber' | 'sky'; children: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={clsx(
        'flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0',
        { rose: 'bg-rose-50 text-rose-800', amber: 'bg-amber-50 text-amber-900', sky: 'bg-sky-50 text-sky-900' }[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}
