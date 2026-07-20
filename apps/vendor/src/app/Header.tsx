import Link from 'next/link';
import { signOutForm } from '@/lib/session-ui';

/**
 * The bar every signed-in page wears. The mark links home, as a logo should.
 *
 * Carries no name: on a tool with three staff accounts, whose session this is answers a question
 * nobody was asking, and it read as a second brand sitting beside the real one.
 */
export default function Header() {
  return (
    <header className="border-b border-mist bg-white/80 backdrop-blur sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3">
          <img src="/brand/klasio-lockup.png" alt="Klasio" className="h-7 w-auto" />
          <span className="text-sm text-slate border-l border-mist pl-3">Licensing</span>
        </Link>
        {signOutForm()}
      </div>
    </header>
  );
}
