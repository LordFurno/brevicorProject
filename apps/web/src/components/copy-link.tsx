'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import clsx from 'clsx';

/** Shows an absolute URL for a path and copies it. Origin is resolved client-side. */
export function CopyLink({ path, className }: { path: string; className?: string }) {
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}${path}`;

  return (
    <div className={clsx('flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5 pl-3.5', className)}>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-600">{origin ? url : path}</span>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50"
      >
        {copied ? <Check className="size-3.5 text-brand-600" /> : <Copy className="size-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
