import Link from 'next/link';
import { Logo } from '@/components/logo';
import { buttonClasses } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <div className="max-w-sm text-center animate-fade-in">
        <Logo />
        <p className="mt-10 text-sm font-medium text-brand-600">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">We couldn’t find that page</h1>
        <p className="mt-2 text-slate-600">The link may be out of date or mistyped.</p>
        <Link href="/" className={buttonClasses('primary', 'md', 'mt-6')}>
          Go home
        </Link>
      </div>
    </div>
  );
}
