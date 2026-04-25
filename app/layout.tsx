import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ListFlow — Multichannel Listing Engine',
  description: 'Publish products to eBay, Etsy, Amazon from a single panel.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-zinc-900">{children}</body>
    </html>
  );
}
