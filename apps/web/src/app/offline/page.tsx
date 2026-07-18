export const metadata = { title: 'Offline — EYO' };

/** Shown only when a page is requested with no connection and nothing cached for it. */
export default function OfflinePage() {
  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="card max-w-md p-8 text-center">
        <p className="font-display text-2xl">You are offline</p>
        <p className="text-sm text-oat mt-2">
          This page has not been opened on this device yet, so there is nothing saved to show.
        </p>
        <p className="text-sm text-oat mt-3">
          Registers and marks you entered while offline are safe on this device and will sync on
          their own once the connection returns.
        </p>
      </div>
    </main>
  );
}
