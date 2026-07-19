'use client';

import { Button } from '@/components/Button';
import { PrintIcon } from '@/components/icons';

export default function PrintButton() {
  return (
    <Button
      onClick={() => window.print()}
      icon={<PrintIcon />}
      data-tip="Prints exactly as shown — A4 portrait"
      className="tip"
    >
      Print terminal report
    </Button>
  );
}
