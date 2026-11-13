// The app mark, drawn for next/og (icons, link previews): a Carbon-blue square with three
// white timeline bars at staggered starts, like items laid out across weeks.

export const BRAND_BLUE = "#0f62fe";
export const SITE_NAME = "Content Plan";
export const SITE_DESCRIPTION =
  "A week-by-week content plan for Framer templates, components and launches. Drop in a rough note and it becomes dated posts for X, Contra and the Framer Marketplace.";

/** Absolute site URL for metadata: APP_URL, else Vercel's production domain, else localhost. */
export function siteUrl(): URL {
  const raw =
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    "http://localhost:3000";
  return new URL(raw);
}

const BARS = [
  { left: 0.2, width: 0.42 },
  { left: 0.34, width: 0.46 },
  { left: 0.2, width: 0.6 },
];

/** The mark at `size` px. `inset` adds padding for maskable / Apple icons, which get cropped. */
export function Mark({ size, inset = 0 }: { size: number; inset?: number }) {
  const inner = size * (1 - inset * 2);
  const bar = Math.max(2, Math.round(inner * 0.11));
  const gap = Math.max(2, Math.round(inner * 0.1));
  return (
    <div
      style={{
        width: size,
        height: size,
        background: BRAND_BLUE,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: inner, height: inner, display: "flex", flexDirection: "column", justifyContent: "center", gap }}>
        {BARS.map((b, i) => (
          <div key={i} style={{ display: "flex", height: bar }}>
            <div style={{ width: Math.round(inner * b.left) }} />
            <div style={{ width: Math.round(inner * b.width), height: bar, background: "#ffffff" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
