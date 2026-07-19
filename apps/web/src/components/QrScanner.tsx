'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';

/**
 * Camera scanning for the gate.
 *
 * Uses the browser's own BarcodeDetector rather than a bundled decoder. A gate device is often
 * a cheap Android phone on a school's own wifi, and shipping a WASM decoder to it is a slow
 * first load for something Chrome already does natively. Where the API is missing — iOS Safari,
 * older Android — this renders nothing and the typed code entry beside it remains the way in.
 * The card always carries the code in text for exactly that reason.
 */

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

export default function QrScanner({ onScan }: { onScan: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(
      typeof window !== 'undefined' &&
        'BarcodeDetector' in window &&
        !!navigator.mediaDevices?.getUserMedia,
    );
  }, []);

  useEffect(() => {
    if (!open || !supported) return;
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The back camera on a phone clamped to a desk or held at a gate.
          video: { facingMode: 'environment' },
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor })
          .BarcodeDetector;
        const detector = new Ctor({ formats: ['qr_code'] });

        const tick = async () => {
          if (stopped) return;
          try {
            const found = await detector.detect(video);
            if (found[0]?.rawValue) {
              // One scan per opening. Closing immediately stops a card held in frame from
              // firing the release over and over.
              stopped = true;
              setOpen(false);
              onScan(found[0].rawValue.trim());
              return;
            }
          } catch {
            // A single failed frame is normal while focusing; keep looking.
          }
          raf = requestAnimationFrame(() => void tick());
        };
        void tick();
      } catch {
        setError('Could not open the camera. Type the code from the card instead.');
        setOpen(false);
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, supported, onScan]);

  if (!supported) return null;

  return (
    <div className="mt-3">
      {/* No icon on either control: nothing in the set means "camera". */}
      {!open ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setError('');
            setOpen(true);
          }}
        >
          Scan a card
        </Button>
      ) : (
        <div className="space-y-2">
          <video
            ref={videoRef}
            muted
            playsInline
            className="w-full max-w-sm rounded-lg border border-mist bg-ink/5 aspect-[4/3] object-cover"
          />
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Stop scanning
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-danger mt-2">{error}</p>}
    </div>
  );
}
