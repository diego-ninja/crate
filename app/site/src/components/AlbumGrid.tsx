/**
 * Decorative 4×N grid of stylised album squares for the hero background.
 *
 * These are not real covers — they're pure CSS gradients with varying hue,
 * pattern, and noise, blurred and slightly desaturated so the eye reads
 * "wall of music" without any single square grabbing focus. The whole
 * grid drifts slowly (see `.drift` in index.css) to avoid feeling static
 * without crossing into "loud web animation" territory.
 */

// Deterministic tile factory — 40 tiles, each with a stable style picked
// by index. Stable ordering keeps SSR/CSR output consistent and avoids
// layout shift on reload.
function tileStyle(i: number): React.CSSProperties {
  const hues = [185, 200, 220, 260, 290, 340, 20, 40];
  const hue = hues[i % hues.length]!;
  const patterns = [
    // soft dual-gradient
    `linear-gradient(135deg, hsl(${hue}, 55%, 38%) 0%, hsl(${(hue + 30) % 360}, 60%, 18%) 100%)`,
    // radial glow
    `radial-gradient(circle at 30% 20%, hsl(${hue}, 60%, 48%) 0%, hsl(${(hue + 20) % 360}, 40%, 14%) 70%)`,
    // striped
    `linear-gradient(180deg, hsl(${hue}, 60%, 32%), hsl(${(hue + 200) % 360}, 45%, 18%))`,
    // muted solid
    `linear-gradient(160deg, hsl(${hue}, 40%, 28%), hsl(${(hue + 60) % 360}, 35%, 12%))`,
  ];
  const pattern = patterns[i % patterns.length]!;
  return { background: pattern };
}

export function AlbumGrid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        className="drift absolute -inset-[15%] grid gap-3 opacity-[0.22] blur-[2px]"
        style={{
          gridTemplateColumns: "repeat(10, minmax(0, 1fr))",
          filter: "saturate(0.8) brightness(0.85)",
        }}
      >
        {Array.from({ length: 80 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded-lg"
            style={tileStyle(i)}
          />
        ))}
      </div>
      {/* Strong vignette that darkens edges and preserves centre contrast */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#07070b_75%)]" />
    </div>
  );
}
