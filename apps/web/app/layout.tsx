import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Sidebar from '@/components/Sidebar';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'B8 Finance',
  description: 'Personal finance dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-screen overflow-hidden bg-slate-50 text-slate-900">
        <Sidebar />
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </body>
    </html>
  );
}
