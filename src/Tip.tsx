import type { ReactNode } from 'react';

/**
 * Hoverable explainer: dotted underline with a styled popup. `focusable` also opens it from the keyboard (Tab to it),
 * for explanations inside a dialog that a keyboard user must be able to read.
 */
export function Tip({ label, tip, focusable = false }: { label: ReactNode; tip: string; focusable?: boolean }) {
  return (
    <span className="tip" tabIndex={focusable ? 0 : undefined}>
      {label}
      <span className="tip-pop">{tip}</span>
    </span>
  );
}
