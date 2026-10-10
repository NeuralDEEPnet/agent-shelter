const GLYPHS: Record<string, string[]> = {
  N: ["10001", "11001", "11001", "10101", "10011", "10011", "10001"],
  O: ["01110", "11011", "10001", "10001", "10001", "11011", "01110"],
  A: ["01110", "11011", "10001", "10001", "11111", "10001", "10001"],
  G: ["01111", "11000", "10000", "10111", "10001", "11001", "01111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  D: ["11110", "10011", "10001", "10001", "10001", "10011", "11110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
};

/** Accessible real heading copy underneath a deliberately chunky bitmap treatment. */
export function PixelType({ text, className }: { text: string; className?: string }) {
  const width = text.length * 6 - 1;
  return (
    <span className={className}>
      <span className="sr-only">{text} </span>
      <svg viewBox={`0 0 ${width} 7`} aria-hidden="true" shapeRendering="crispEdges" preserveAspectRatio="xMinYMin meet" className="pixel-type">
        {[...text].flatMap((letter, i) => (GLYPHS[letter] ?? []).flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === "1" ? [<rect key={`${i}-${x}-${y}`} x={i * 6 + x} y={y} width="1" height="1" fill="currentColor" />] : [])))}
      </svg>
    </span>
  );
}
