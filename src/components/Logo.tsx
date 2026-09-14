/**
 * The IntelMotion mark.
 *
 * HOW TO PUT THE REAL LOGO IN: drop the artwork into `public/logo.svg`,
 * replacing the file that is there. Nothing else changes — no code, no
 * rebuilding this component. A PNG works too: name it `logo.png` and change the
 * one `src` below.
 *
 * The file currently in `public/` is a RECONSTRUCTION drawn from a screenshot,
 * because this environment cannot reach intelmotionlifts.com to fetch the
 * original. If that file is ever missing or fails to load, the component falls
 * back to an inline copy of the same drawing rather than leaving a broken image
 * in the header — and the inline copy renders in the page's own Poppins, which
 * an <img>-loaded SVG cannot reach.
 */

import { useState } from 'react';

export function Logo({
  height = 28,
  withWordmark = true,
}: {
  height?: number;
  withWordmark?: boolean;
}) {
  const [fileFailed, setFileFailed] = useState(false);

  if (!fileFailed && withWordmark) {
    return (
      <img
        src="/logo.svg"
        alt="IntelMotion"
        height={height}
        className="logo"
        onError={() => setFileFailed(true)}
      />
    );
  }

  return <InlineMark height={height} withWordmark={withWordmark} />;
}

/** The same drawing, inline, so the page's webfont applies to the wordmark. */
function InlineMark({ height, withWordmark }: { height: number; withWordmark: boolean }) {
  return (
    <svg
      viewBox={withWordmark ? '0 0 330 72' : '0 0 72 72'}
      height={height}
      width={height * (withWordmark ? 330 / 72 : 1)}
      role="img"
      aria-label="IntelMotion"
      className="logo"
    >
      <circle cx="17" cy="53" r="11" fill="#F9A825" />
      <rect x="30" y="17" width="14" height="44" rx="7" fill="#22BFC4" />
      <rect x="52" y="5" width="16" height="56" rx="8" fill="#2D68E0" />
      {withWordmark && (
        // Pinned to an exact width, so a missing webfont cannot clip the mark.
        <text x="86" y="52" className="logo-word" textLength={236} lengthAdjust="spacingAndGlyphs">
          IntelMotion
        </text>
      )}
    </svg>
  );
}
