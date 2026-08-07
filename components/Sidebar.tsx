'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, PieChart, Landmark, ArrowLeftRight, Zap,
  Tag, Building2, Home, Sparkles, Upload,
} from 'lucide-react';

const NAV = [
  { href: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/budget',       label: 'Budget',        icon: PieChart },
  { href: '/balances',     label: 'Balances',      icon: Landmark },
  { href: '/transactions', label: 'Transactions',  icon: ArrowLeftRight },
  { href: '/rules',        label: 'Rules',         icon: Zap },
  { href: '/categories',   label: 'Categories',    icon: Tag },
  { href: '/accounts',     label: 'Accounts',      icon: Building2 },
  { href: '/properties',   label: 'Properties',    icon: Home },
  { href: '/import',       label: 'Import CSV',    icon: Upload },
];

function NavItem({ href, label, icon: Icon, pathname }: { href: string; label: string; icon: React.ElementType; pathname: string }) {
  const active = pathname === href || (href !== '/' && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-white/10 text-white font-medium'
          : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
      }`}
    >
      <Icon size={16} className="shrink-0" />
      {label}
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[220px] shrink-0 bg-slate-900 flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 pt-7 pb-6">
        <div className="text-white font-bold text-xl tracking-tight">B8</div>
        <div className="text-slate-500 text-xs mt-0.5 font-medium tracking-wider uppercase">Finance</div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-3 space-y-0.5">
        {NAV.map((item) => <NavItem key={item.href} {...item} pathname={pathname} />)}
      </nav>

      {/* Intelligence section */}
      <div className="px-3 pb-6">
        <div className="border-t border-slate-800 mb-3" />
        <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-2">
          Intelligence
        </p>
        <NavItem href="/insights" label="Insights" icon={Sparkles} pathname={pathname} />
      </div>
    </aside>
  );
}
