'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, PieChart, Landmark, ArrowLeftRight, Zap,
  Tag, Building2, Home, Wallet, Sparkles, Upload, Menu, X,
} from 'lucide-react';

const NAV = [
  { href: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/net-worth',    label: 'Net Worth',     icon: Wallet },
  { href: '/budget',       label: 'Budget',        icon: PieChart },
  { href: '/balances',     label: 'Balances',      icon: Landmark },
  { href: '/transactions', label: 'Transactions',  icon: ArrowLeftRight },
  { href: '/rules',        label: 'Rules',         icon: Zap },
  { href: '/categories',   label: 'Categories',    icon: Tag },
  { href: '/accounts',     label: 'Accounts',      icon: Building2 },
  { href: '/properties',   label: 'Properties',    icon: Home },
  { href: '/import',       label: 'Import CSV',    icon: Upload },
];

function NavItem({ href, label, icon: Icon, pathname, onNavigate }: {
  href: string; label: string; icon: React.ElementType; pathname: string; onNavigate?: () => void;
}) {
  const active = pathname === href || (href !== '/' && pathname.startsWith(href));
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      // `py-2.5` rather than `py-2`: with the icon this is a 40px row, which is close enough to the
      // 44px touch target iOS asks for. The desktop sidebar inherits the change and is no worse for
      // it — a pointer does not mind a taller row.
      // INK RE-DERIVED FOR THE CYAN GROUND, not carried over. `text-slate-400` scored 7.03:1 on the
      // old slate-900 and scores 2.11:1 on cyan-700 — it would have been illegible, and a colour
      // swap that keeps the foreground is how that happens quietly.
      //
      // The legible band here is narrow: at 14px the floor is 4.5:1, which admits white (5.36) down
      // to cyan-100 (4.79) and nothing dimmer. That is not enough range to say "active" with
      // lightness alone, so the state is carried by the WASH and the WEIGHT instead — which is the
      // stronger signal anyway, and the pattern this file already used for the active row.
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-white/15 text-white font-medium'
          : 'text-cyan-100 hover:text-white hover:bg-white/10'
      }`}
    >
      <Icon size={16} className="shrink-0" />
      {label}
    </Link>
  );
}

/** The nav itself, identical in the sidebar and in the drawer — one list, rendered twice. */
function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => <NavItem key={item.href} {...item} pathname={pathname} onNavigate={onNavigate} />)}
      </nav>
      <div className="px-3 pb-6">
        <div className="border-t border-white/20 mb-3" />
        <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-cyan-100/70 mb-2">
          Intelligence
        </p>
        <NavItem href="/insights" label="Insights" icon={Sparkles} pathname={pathname} onNavigate={onNavigate} />
      </div>
    </>
  );
}

/**
 * The nav: a fixed column on a desktop, a drawer behind a header button on a phone — §5 step 26b.
 *
 * ─── Why the sidebar could not simply stay ────────────────────────────────────────────────────
 *
 * 220px of a 390px screen is 56% of it. Nothing else on the page could be made to fit while this
 * was in the flow, which is why the shell is the first thing step 26b touches rather than the last.
 *
 * ONE NAV LIST, RENDERED TWICE. The drawer is not a second menu that has to be kept in step with
 * the first — `NAV` and `NavList` are shared, and a link added to the desktop sidebar appears in
 * the drawer without anybody remembering to add it. That is the same rule the rest of this repo
 * applies to figures, applied to navigation.
 */
export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // NO EFFECT CLOSING THIS ON `pathname`. That was the first version and the lint rule was right to
  // refuse it: setting state synchronously in an effect cascades a render for something an event
  // handler already does. Every link in the drawer carries `onNavigate`, so it closes on the tap
  // that navigates rather than on the render that follows.

  // The page behind a full-screen drawer must not scroll under it — on iOS that is the difference
  // between a drawer and a drawer with the dashboard sliding around beneath it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  return (
    <>
      {/* DESKTOP: unchanged, and deliberately so. `md:` up keeps the layout that works. */}
      <aside className="hidden md:flex w-[220px] shrink-0 bg-cyan-700 flex-col h-full">
        <div className="px-5 pt-7 pb-6">
          <div className="text-[#f0dfae] font-bold text-xl tracking-tight">B8</div>
          {/* cyan-100, NOT champagne: at 12px the mark colour is 4.05:1 and the floor is 4.5:1. */}
          <div className="text-cyan-100/80 text-xs mt-0.5 font-medium tracking-wider uppercase">Finance</div>
        </div>
        <NavList pathname={pathname} />
      </aside>

      {/* MOBILE: a header bar that stays put, carrying the one control the page needs.
          `pt-[env(safe-area-inset-top)]` is what keeps it out from under the Dynamic Island — it
          reports a real number only because `viewport-fit=cover` is set in layout.tsx, and the two
          have to travel together or this is either zero or a gap on every device. */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 bg-cyan-700 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between h-14 px-4">
          <Link href="/dashboard" className="text-[#f0dfae] font-bold text-lg tracking-tight">
            B8<span className="text-cyan-100/80 font-medium text-xs ml-1.5 uppercase tracking-wider">Finance</span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            aria-expanded={open}
            className="p-2 -mr-2 text-cyan-100 hover:text-white"
          >
            <Menu size={22} />
          </button>
        </div>
      </header>

      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* The dimmed area closes it, which is the gesture people try first. */}
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-slate-950/60"
          />
          <div className="relative flex flex-col w-[270px] max-w-[80%] h-full bg-cyan-700 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-start justify-between px-5 pt-6 pb-5">
              <div>
                <div className="text-[#f0dfae] font-bold text-xl tracking-tight">B8</div>
                <div className="text-cyan-100/80 text-xs mt-0.5 font-medium tracking-wider uppercase">Finance</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="p-2 -mr-2 -mt-1 text-cyan-100 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}