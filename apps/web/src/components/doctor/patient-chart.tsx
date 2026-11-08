'use client';

import clsx from 'clsx';
import { useState, type ReactNode } from 'react';
import {
  CreditCard,
  Database,
  FlaskConical,
  HeartPulse,
  History,
  Languages,
  MessageSquareQuote,
  Phone,
  Pill,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TriangleAlert,
} from 'lucide-react';
import { Alert, Avatar, Badge, Textarea } from '@/components/ui';
import type { ChartSummary } from '@/lib/clinical/types';
import { ageFrom, formatYmd } from '@/lib/time';

type Tab = 'overview' | 'history' | 'notes';

export function PatientChart({ chart, reason, clinicName }: { chart: ChartSummary; reason: string; clinicName: string }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [notes, setNotes] = useState('');
  const p = chart.patient;
  const age = p.birthDate ? ageFrom(p.birthDate) : undefined;
  const critical = chart.allergies.filter((a) => a.critical);

  return (
    <div className="mx-auto max-w-2xl px-5 py-6 sm:px-8 sm:py-8">
      {/* Identity */}
      <div className="flex items-start gap-4">
        <Avatar name={p.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">{p.name}</h2>
            <Badge tone={chart.source === 'fhir' ? 'brand' : 'violet'}>
              <Database /> {chart.source === 'fhir' ? `${clinicName} · FHIR` : 'Mock clinic data'}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            {[age !== undefined && `${age} y`, p.sex, p.birthDate && `DOB ${formatYmd(p.birthDate)}`].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {p.healthCard && <Chip icon={<CreditCard />}>OHIP ••••{p.healthCard.replace(/\D/g, '').slice(-3)}</Chip>}
            {p.phone && <Chip icon={<Phone />}>{p.phone}</Chip>}
            {p.language && <Chip icon={<Languages />}>{p.language}</Chip>}
          </div>
        </div>
      </div>

      {chart.error && (
        <Alert className="mt-5">
          <TriangleAlert /> {chart.error}
        </Alert>
      )}
      {!chart.matched && !chart.error && (
        <Alert tone="amber" className="mt-5">
          <TriangleAlert />
          <span>
            No matching record was found at the clinic for this name, date of birth and health card.
            {chart.source === 'mock' && ' Showing sample data for the demo.'}
          </span>
        </Alert>
      )}

      {/* Reason for visit */}
      <section className="mt-6 rounded-2xl bg-brand-50/70 p-4 ring-1 ring-brand-100">
        <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-brand-700 uppercase">
          <MessageSquareQuote className="size-3.5" /> Reason for visit
        </p>
        <p className="mt-1.5 text-[15px] leading-relaxed text-slate-800">{reason}</p>
      </section>

      {/* Allergies — always visible */}
      <section
        className={clsx(
          'mt-3 rounded-2xl p-4 ring-1',
          chart.allergies.length ? 'bg-rose-50/70 ring-rose-100' : 'bg-slate-50 ring-slate-100',
        )}
      >
        <p className={clsx('flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase', chart.allergies.length ? 'text-rose-700' : 'text-slate-500')}>
          {chart.allergies.length ? <ShieldAlert className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
          Allergies {critical.length > 0 && <span className="normal-case tracking-normal">· {critical.length} high risk</span>}
        </p>
        {chart.allergies.length ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {chart.allergies.map((a) => (
              <li
                key={a.substance}
                className={clsx(
                  'rounded-lg bg-white px-2.5 py-1.5 text-sm shadow-sm ring-1',
                  a.critical ? 'ring-rose-200' : 'ring-slate-200',
                )}
              >
                <span className={clsx('font-medium', a.critical && 'text-rose-700')}>{a.substance}</span>
                {a.reaction && <span className="text-slate-500"> — {a.reaction}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-slate-600">No known allergies</p>
        )}
      </section>

      {/* Tabs */}
      <div role="tablist" className="sticky top-0 z-10 -mx-1 mt-6 flex gap-1 rounded-xl bg-slate-100/90 p-1 backdrop-blur">
        {(
          [
            ['overview', 'Overview'],
            ['history', `Past visits (${chart.visits.length})`],
            ['notes', 'Visit notes'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            type="button"
            onClick={() => setTab(id)}
            className={clsx(
              'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition',
              tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div key={tab} className="mt-5 animate-fade-in">
        {tab === 'overview' && (
          <div className="space-y-5">
            <Section icon={<Stethoscope />} title="Active conditions" empty="No active conditions recorded" count={chart.conditions.length}>
              <ul className="divide-y divide-slate-100">
                {chart.conditions.map((c) => (
                  <li key={c.name} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-sm font-medium">{c.name}</span>
                    {c.onset && <span className="shrink-0 text-xs text-slate-400">since {formatYmd(c.onset, { year: 'numeric' })}</span>}
                  </li>
                ))}
              </ul>
            </Section>

            <Section icon={<Pill />} title="Medications" empty="No active medications" count={chart.medications.length}>
              <ul className="divide-y divide-slate-100">
                {chart.medications.map((m) => (
                  <li key={m.name} className="py-2.5">
                    <p className="text-sm font-medium">{m.name}</p>
                    {m.dosage && <p className="text-xs text-slate-500">{m.dosage}</p>}
                  </li>
                ))}
              </ul>
            </Section>

            <Section
              icon={<HeartPulse />}
              title="Latest vitals"
              empty="No vitals on file"
              count={chart.vitals.length}
              aside={chart.vitals[0]?.date && <span className="text-xs text-slate-400">{formatYmd(chart.vitals[0].date)}</span>}
            >
              <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3">
                {chart.vitals.map((v) => (
                  <div key={v.label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{v.label}</p>
                    <p className="mt-0.5 font-semibold tabular-nums">
                      {v.value}
                      {v.unit && <span className="ml-1 text-xs font-normal text-slate-500">{v.unit}</span>}
                    </p>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={<FlaskConical />} title="Recent labs" empty="No recent lab results" count={chart.labs.length}>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {chart.labs.map((l) => (
                    <tr key={l.label}>
                      <td className="py-2.5 font-medium">{l.label}</td>
                      <td className="py-2.5 text-right tabular-nums">
                        <span className={clsx(l.flag === 'H' || l.flag === 'HH' ? 'font-semibold text-rose-600' : l.flag === 'L' || l.flag === 'LL' ? 'font-semibold text-sky-600' : '')}>
                          {l.value}
                        </span>
                        {l.unit && <span className="ml-1 text-xs text-slate-400">{l.unit}</span>}
                      </td>
                      <td className="w-10 py-2.5 text-right">
                        {l.flag && l.flag !== 'N' && <Badge tone={l.flag.startsWith('H') ? 'rose' : 'sky'}>{l.flag}</Badge>}
                      </td>
                      <td className="hidden w-24 py-2.5 text-right text-xs text-slate-400 sm:table-cell">{l.date && formatYmd(l.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </div>
        )}

        {tab === 'history' &&
          (chart.visits.length ? (
            <ol className="relative space-y-5 border-l border-slate-200 pl-6">
              {chart.visits.map((v, i) => (
                <li key={v.id ?? i} className="relative">
                  <span className="absolute top-1.5 -left-[29px] size-2.5 rounded-full bg-white ring-2 ring-brand-500" />
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{v.reason ?? 'Visit'}</p>
                    {v.type && <Badge tone={v.type === 'Virtual' ? 'sky' : 'neutral'}>{v.type}</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{[v.date && formatYmd(v.date), v.practitioner].filter(Boolean).join(' · ')}</p>
                  {v.summary && <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">{v.summary}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <Empty icon={<History />} text="No previous visits on file" />
          ))}

        {tab === 'notes' && (
          <div className="space-y-4">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Subjective, objective, assessment, plan…"
              className="min-h-56"
              aria-label="Visit notes"
            />
            <p className="text-xs text-slate-500">Draft only — notes aren’t saved to the chart in this demo.</p>
            <div className="flex items-start gap-3 rounded-2xl border border-dashed border-slate-300 p-4">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-500" />
              <div>
                <p className="text-sm font-medium">Transcript &amp; AI summary</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  When transcription is enabled (with patient consent), an unverified transcript will appear here for your review before it’s filed to the chart.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  empty,
  aside,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  empty: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 [&_svg]:size-4 [&_svg]:text-slate-400">
          {icon} {title}
        </h3>
        {aside}
      </div>
      {count ? children : <p className="py-2 text-sm text-slate-400">{empty}</p>}
    </section>
  );
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600 [&_svg]:size-3.5 [&_svg]:text-slate-400">
      {icon}
      {children}
    </span>
  );
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center py-12 text-center text-sm text-slate-400 [&_svg]:size-6">
      {icon}
      <p className="mt-2">{text}</p>
    </div>
  );
}
