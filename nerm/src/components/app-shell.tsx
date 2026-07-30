import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { SignOutButton } from './sign-out-button';
import { DemoBanner } from './demo-banner';
import type { Actor } from '@/lib/authz/scope';
import { isAdmin, isAuditor, isVendorOnly, hasRole } from '@/lib/authz/scope';
import { cn, initials } from '@/lib/ui';

type NavItem = { href: string; label: string };

function navFor(actor: Actor): NavItem[] {
  // The vendor portal is a different product to its users — a scoped roster and
  // their own submissions, not a filtered view of the internal console.
  if (isVendorOnly(actor)) {
    return [
      { href: '/vendor', label: 'Our people' },
      { href: '/vendor/new', label: 'Submit a worker' },
      { href: '/vendor/tasks', label: 'Tasks' },
    ];
  }

  const items: NavItem[] = [{ href: '/', label: 'Home' }];
  if (hasRole(actor, 'SPONSOR') || isAdmin(actor) || isAuditor(actor)) {
    items.push({ href: '/people', label: 'People' });
    items.push({ href: '/tasks', label: 'Tasks' });
  }
  if (isAdmin(actor)) {
    items.push({ href: '/admin/workflows', label: 'Workflows' });
    items.push({ href: '/admin/vendors', label: 'Vendors' });
    items.push({ href: '/admin/api-clients', label: 'API clients' });
  }
  if (isAdmin(actor) || isAuditor(actor)) {
    items.push({ href: '/audit', label: 'Audit' });
  }
  return items;
}

function roleLabel(actor: Actor): string {
  if (isVendorOnly(actor)) return 'Vendor administrator';
  if (isAdmin(actor)) return 'IAM administrator';
  if (isAuditor(actor)) return 'Auditor';
  if (hasRole(actor, 'SPONSOR')) return 'Sponsor';
  return 'No role assigned';
}

export function AppShell({
  actor,
  children,
}: {
  actor: Actor;
  children: React.ReactNode;
}) {
  const nav = navFor(actor);
  const vendorMode = isVendorOnly(actor);

  return (
    <div className="min-h-screen">
      <DemoBanner />
      <header
        className={cn(
          'sticky top-0 z-40 border-b border-border backdrop-blur',
          vendorMode ? 'bg-slate-900/95 text-slate-100' : 'bg-card/95',
        )}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Link href={vendorMode ? '/vendor' : '/'} className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <span className="hidden sm:inline">
              {vendorMode ? 'Vendor portal' : 'Non-Employee Risk Management'}
            </span>
          </Link>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  vendorMode
                    ? 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {!vendorMode && <ThemeToggle />}
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium leading-tight">{actor.name}</div>
              <div
                className={cn(
                  'text-xs leading-tight',
                  vendorMode ? 'text-slate-400' : 'text-muted-foreground',
                )}
              >
                {roleLabel(actor)}
              </div>
            </div>
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold',
                vendorMode ? 'bg-slate-700 text-slate-100' : 'bg-primary text-primary-foreground',
              )}
              aria-hidden
            >
              {initials(actor.name.split(' ')[0] ?? 'U', actor.name.split(' ')[1] ?? ' ')}
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
