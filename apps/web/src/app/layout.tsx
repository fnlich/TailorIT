import type { Metadata, Viewport } from 'next';
import { Figtree } from 'next/font/google';
import { AppProviders } from '@/components/providers/AppProviders';
import '@/styles/globals.css';

// Figtree stands in for Simplify's commercial "Circular Std". A licensed Circular is a swap to next/font/local.
const figtree = Figtree({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-figtree',
});

export const metadata: Metadata = {
  title: { default: 'TailorIT', template: '%s · TailorIT' },
  description: 'Find jobs, track applications and manage your resumes and cover letters.',
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={figtree.variable}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
