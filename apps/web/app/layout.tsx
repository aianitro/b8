import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Sidebar from '@/components/Sidebar';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'B8 Finance',
  description: 'Personal finance dashboard',
  /**
   * What iOS needs to treat this as an app rather than a bookmark — §5 step 26b.
   *
   * `capable` is what makes an installed Home Screen launch open WITHOUT Safari's chrome. Without
   * it the manifest's `display: standalone` is ignored on iOS, which is the one platform this is
   * for: Apple has never implemented that part of the manifest and reads these meta tags instead.
   *
   * `black-translucent` draws the page under the status bar, which is only correct because the
   * layout below accounts for it with `env(safe-area-inset-*)`. Set without that, the first line of
   * every screen sits under the clock — the same fault the phone app had until this morning.
   */
  appleWebApp: {
    capable: true,
    title: 'B8',
    statusBarStyle: 'black-translucent',
  },
};

/**
 * THE SINGLE MOST IMPORTANT LINE FOR MOBILE, and it was absent.
 *
 * With no viewport declared, iOS Safari renders at an assumed 980px and scales the result down —
 * which is why this app has been a pinch-and-zoom experience on a phone regardless of any CSS
 * underneath. Every responsive class in the codebase was inert.
 *
 * NO `maximumScale` OR `userScalable: false`. Locking zoom is the usual companion to this change
 * and it is an accessibility failure: it takes pinch-to-zoom away from readers who need it, to fix
 * a double-tap-zoom annoyance that `width=device-width` has already fixed.
 *
 * `viewportFit: 'cover'` lets the page reach under the Dynamic Island and the home indicator, which
 * is required for `env(safe-area-inset-*)` to report anything but zero — and those insets are what
 * the layout uses to stay clear of both.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // The same slate-900 the manifest declares and the mobile header paints. White was wrong here:
  // the top of every mobile page is that dark bar, so a white chrome tint left a seam above it.
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      {/* `h-dvh`, not `h-screen`. `100vh` on iOS is the height the viewport has with the browser
          chrome HIDDEN, so a page sized to it is taller than the space it gets and the last inch
          hides behind the toolbar. The dynamic unit is the one that tracks what is actually
          visible, and it costs nothing on a desktop where the two are equal. */}
      <body className="flex h-dvh overflow-hidden bg-slate-50 text-slate-900">
        <ServiceWorkerRegistrar />
        <Sidebar />
        {/* `pt-14` clears the fixed mobile header, plus the island above it; both vanish at `md:`
            where the header does not exist and the sidebar is back in the flow. The inset is added
            to the padding rather than applied to the scroll container, so the page scrolls UNDER
            the status bar rather than starting below a permanent gap. */}
        <div className="flex-1 overflow-auto pt-[calc(3.5rem+env(safe-area-inset-top))] md:pt-0">
          {children}
        </div>
      </body>
    </html>
  );
}
