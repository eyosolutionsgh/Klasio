import Link from 'next/link';
import { signOutForm } from '@/lib/session-ui';
import HeaderNav from './HeaderNav';

/**
 * The bar every signed-in page wears. The mark links home, as a logo should.
 *
 * Carries no name: on a tool with three staff accounts, whose session this is answers a question
 * nobody was asking, and it read as a second brand sitting beside the real one.
 *
 * "Licensing" says which Klasio tool this is, and it used to be set in the same size and colour as
 * the links beside it — so it read as a fourth destination that happened not to do anything when
 * clicked. It is smaller, tracked out and lighter now, which is how a label differs from a link.
 * The separating rule earns its keep for the same reason.
 */
export default function Header() {
  return (
    <header className="border-b border-mist bg-white/80 backdrop-blur sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-5 min-w-0">
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <img src="/brand/klasio-lockup.png" alt="Klasio" className="h-7 w-auto" />
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-oat border-l border-mist pl-3">
              Licensing
            </span>
          </Link>
          {/*
            Two places, so two links. Building a product and selling one are different jobs, and
            the packages page is where the first happens.
          */}
          <HeaderNav />
        </div>
        {signOutForm()}
      </div>
    </header>
  );
}
