/**
 * The IntelMotion mark.
 *
 * NOT THE REAL ARTWORK. This environment cannot reach intelmotionlifts.com — the
 * proxy refuses the connection — so the official logo file could not be copied.
 * What follows is a wordmark drawn from the brand's own colours, standing in
 * until the real file is dropped in.
 *
 * TO USE THE REAL LOGO: save it as `public/logo.svg` (or .png) and replace the
 * <svg> below with `<img src="/logo.svg" alt="IntelMotion" height={height} />`.
 * Nothing else in the application needs to change — every place the mark appears
 * renders this component.
 *
 * The glyph is a lift car between two guide rails, with the car mid-travel: the
 * one shape that says "elevator" at sixteen pixels without a caption.
 */

export function Logo({
  height = 28,
  withWordmark = true,
}: {
  height?: number;
  withWordmark?: boolean;
}) {
  const width = withWordmark ? height * 6.6 : height;

  return (
    <svg
      viewBox={withWordmark ? '0 0 264 40' : '0 0 40 40'}
      width={width}
      height={height}
      role="img"
      aria-label="IntelMotion"
      className="logo"
    >
      {/* Guide rails */}
      <rect x="4" y="3" width="4" height="34" rx="2" fill="var(--brand-blue)" />
      <rect x="32" y="3" width="4" height="34" rx="2" fill="var(--brand-blue)" />
      {/* The car, mid-travel */}
      <rect x="10" y="12" width="20" height="20" rx="3" fill="var(--brand-teal)" />
      {/* Travelling upward — the amber arrow is the logo's accent colour */}
      <path d="M20 4.5 L26 10.5 H14 Z" fill="var(--brand-amber)" />

      {withWordmark && (
        // ONE text element with two tspans, so the browser lays the halves out
        // sequentially. Two separate <text> elements at a hand-guessed offset
        // overlapped and the mark read "InteMotion" — the width of a word is not
        // something to estimate.
        <text x="48" y="27" className="logo-word">
          Intel<tspan className="logo-word-2">Motion</tspan>
        </text>
      )}
    </svg>
  );
}
