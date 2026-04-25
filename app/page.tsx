import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-xl text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">ListFlow</h1>
        <p className="text-zinc-600">
          Multichannel marketplace listing engine. Publish products to eBay, Etsy, Amazon —
          and your own storefront — from one place, with AI-generated copy.
        </p>
        <div className="flex justify-center gap-3">
          <Link
            href="/admin/listings"
            className="px-4 py-2 rounded-md bg-zinc-900 text-white text-sm hover:bg-zinc-800"
          >
            Admin
          </Link>
          <a
            href="https://github.com/ArseniiB-o/listflow"
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-md border border-zinc-300 text-sm hover:bg-zinc-50"
          >
            GitHub
          </a>
        </div>
      </div>
    </main>
  );
}
