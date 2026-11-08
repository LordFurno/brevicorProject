import clsx from 'clsx';

export function Logo({ className, tone = 'dark', compact }: { className?: string; tone?: 'dark' | 'light'; compact?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-2.5 font-semibold tracking-tight', tone === 'light' ? 'text-white' : 'text-slate-900', className)}>
      <span className="grid size-8 place-items-center rounded-[10px] bg-brand-600 text-white shadow-sm shadow-brand-900/20">
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 12h4l2.5-5 4 10 2.5-5H21" />
        </svg>
      </span>
      {!compact && <span className="text-[17px]">Brevicor</span>}
    </span>
  );
}
