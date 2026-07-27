'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/budget', label: 'Budget' },
  { href: '/balances', label: 'Balances' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/rules', label: 'Rules' },
  { href: '/categories', label: 'Categories' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/insights', label: 'Insights' },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <header className="h-14 border-b bg-white flex items-center px-8 gap-8 sticky top-0 z-20">
      <span className="font-semibold text-base tracking-tight text-gray-900 mr-4">B8</span>
      <nav className="flex items-center gap-1">
        {LINKS.map(({ href, label }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                active
                  ? 'bg-gray-100 text-gray-900 font-medium'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
