import { ImageResponse } from "next/og";
import { BRAND_BLUE, Mark, SITE_NAME } from "@/lib/brand";

export const alt = "Content Plan: a week-by-week content timeline for Framer templates and components";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const WEEKS = [
  { label: "This week", items: [["Wed 11", "Axia launch post", "Published", "#24a148"], ["Fri 13", "Teaser for template #3", "Planned", BRAND_BLUE]] },
  { label: "Next week", items: [["Tue 17", "Share 4 videos", "In progress", "#8a3ffc"]] },
];

/** Link preview: Carbon g100 look — dark shell, the mark, and a sample of the timeline. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#161616", color: "#f4f4f4", fontSize: 28 }}>
        <div style={{ height: 72, display: "flex", alignItems: "center", gap: 20, padding: "0 48px", borderBottom: "1px solid #393939" }}>
          <Mark size={36} />
          <div style={{ display: "flex", fontSize: 26 }}>
            <span style={{ fontWeight: 700 }}>Content</span>
            <span style={{ marginLeft: 8 }}>Plan</span>
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, padding: "56px 48px", gap: 56 }}>
          <div style={{ display: "flex", flexDirection: "column", width: 460, gap: 20 }}>
            <div style={{ fontSize: 64, lineHeight: 1.1 }}>{SITE_NAME}</div>
            <div style={{ fontSize: 28, lineHeight: 1.4, color: "#c6c6c6" }}>
              Rough notes in, a dated week-by-week plan out. For Framer templates, components and launches.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 28 }}>
            {WEEKS.map((w) => (
              <div key={w.label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 24, color: "#c6c6c6" }}>{w.label}</div>
                {w.items.map(([day, title, status, color]) => (
                  <div key={title} style={{ display: "flex", alignItems: "center", background: "#262626", height: 76, padding: "0 20px", gap: 20 }}>
                    <div style={{ width: 80, fontSize: 22, color: "#c6c6c6" }}>{day}</div>
                    <div style={{ flex: 1, fontSize: 24 }}>{title}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, color: "#c6c6c6" }}>
                      <div style={{ width: 12, height: 12, background: color }} />
                      {status}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
