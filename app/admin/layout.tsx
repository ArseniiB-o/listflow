import Link from 'next/link';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/admin/listings" className="font-semibold">ListFlow Admin</Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/admin/listings" className="hover:underline">Listings</Link>
            <Link href="/admin/metrics" className="hover:underline">Metrics</Link>
            <Link href="/" className="text-zinc-500 hover:underline">Exit</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">{children}</main>
    </div>
  );
}
