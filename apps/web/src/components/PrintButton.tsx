'use client';

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      data-tip="Prints exactly as shown — A4 portrait"
      className="tip rounded-lg bg-forest text-paper text-sm font-medium px-5 py-2 hover:bg-forest-deep transition"
    >
      Print report card
    </button>
  );
}
