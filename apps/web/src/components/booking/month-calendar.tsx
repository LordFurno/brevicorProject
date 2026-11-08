'use client';

import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { daysInMonth, formatMonth, pad, weekday } from '@/lib/time';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function MonthCalendar({
  month,
  today,
  available,
  selected,
  loading,
  canPrev,
  onPrev,
  onNext,
  onSelect,
}: {
  month: string;
  today: string;
  available: Set<string>;
  selected: string | null;
  loading: boolean;
  canPrev: boolean;
  onPrev(): void;
  onNext(): void;
  onSelect(ymd: string): void;
}) {
  const lead = weekday(`${month}-01`);
  const total = daysInMonth(month);
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => `${month}-${pad(i + 1)}`),
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">{formatMonth(month)}</h3>
        <div className="flex gap-1">
          <NavButton label="Previous month" onClick={onPrev} disabled={!canPrev}>
            <ChevronLeft className="size-4" />
          </NavButton>
          <NavButton label="Next month" onClick={onNext}>
            <ChevronRight className="size-4" />
          </NavButton>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-2 text-[11px] font-medium tracking-wide text-slate-400 uppercase">
            {d}
          </div>
        ))}
        {cells.map((ymd, i) => {
          if (!ymd) return <div key={`pad-${i}`} />;
          const isAvailable = available.has(ymd);
          const isSelected = ymd === selected;
          return (
            <button
              key={ymd}
              type="button"
              disabled={!isAvailable}
              onClick={() => onSelect(ymd)}
              aria-pressed={isSelected}
              aria-label={ymd}
              className={clsx(
                'relative mx-auto grid aspect-square w-full max-w-11 place-items-center rounded-full text-sm transition',
                isSelected
                  ? 'bg-brand-600 font-semibold text-white shadow-md shadow-brand-900/20'
                  : isAvailable
                    ? 'bg-brand-50 font-semibold text-brand-700 hover:bg-brand-100'
                    : 'text-slate-300',
                loading && 'opacity-50',
              )}
            >
              {Number(ymd.slice(8))}
              {ymd === today && (
                <span className={clsx('absolute bottom-1 size-1 rounded-full', isSelected ? 'bg-white' : 'bg-brand-500')} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({ label, onClick, disabled, children }: { label: string; onClick(): void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-8 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
