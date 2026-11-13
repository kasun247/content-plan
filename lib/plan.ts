// Shared types, constants and date helpers (used by the client and the API routes).

export const CHANNELS = [
  "X",
  "Framer Marketplace",
  "Contra",
  "LinkedIn",
  "Dribbble",
  "YouTube",
  "Threads",
  "Instagram",
  "Newsletter",
  "Other",
] as const;

export const TYPES = [
  "Launch",
  "Post",
  "Thread",
  "Teaser",
  "Video",
  "Showcase",
  "Update",
  "Tutorial",
  "Other",
] as const;

export const STATUSES = ["Idea", "Planned", "In progress", "Published"] as const;

export type Channel = (typeof CHANNELS)[number];
export type ContentType = (typeof TYPES)[number];
export type Status = (typeof STATUSES)[number];

export type Item = {
  id: string;
  title: string;
  date: string | null; // YYYY-MM-DD, local date
  channel: Channel;
  type: ContentType;
  status: Status;
  product: string;
  notes: string;
  source: "note" | "manual" | "starter";
  noteId: string | null;
  images: string[]; // image ids, see /api/image/[id]
  createdAt: string; // ISO
};

export type Note = {
  id: string;
  text: string;
  createdAt: string;
  organised: boolean;
  itemCount: number;
  images: string[];
};

export type Plan = { items: Item[]; notes: Note[] };

/** Fields the organiser produces for each new item. */
export type DraftItem = Pick<Item, "title" | "date" | "channel" | "type" | "status" | "product" | "notes">;

export const CHANNEL_COLOR: Record<Channel, string> = {
  X: "var(--ink)",
  "Framer Marketplace": "#2340d4",
  Contra: "#7b5cff",
  LinkedIn: "#0a66c2",
  Dribbble: "#e04f8a",
  YouTube: "#e0322b",
  Threads: "#6b7080",
  Instagram: "#d9468f",
  Newsletter: "#b76e00",
  Other: "var(--muted)",
};

export const STATUS_CLASS: Record<Status, string> = {
  Idea: "st-idea",
  Planned: "st-planned",
  "In progress": "st-progress",
  Published: "st-published",
};

export const STATUS_COLOR: Record<Status, string> = {
  Idea: "var(--s-idea)",
  Planned: "var(--s-planned)",
  "In progress": "var(--s-progress)",
  Published: "var(--s-published)",
};

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseD = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const weekStart = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
};
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-GB", o);

export const newId = (prefix = "i") =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Image ids look like "img" + base36; at most this many per note or item. */
export const MAX_IMAGES = 4;
export const isImageId = (v: unknown): v is string => typeof v === "string" && /^img[a-z0-9]{6,40}$/.test(v);
export const cleanImages = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter(isImageId))].slice(0, MAX_IMAGES * 2) : [];

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Validate one item coming from the AI or from storage. */
export function cleanDraft(x: unknown): DraftItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const title = String(o.title ?? "").trim().slice(0, 160);
  if (!title) return null;
  const date = isDate(o.date) ? o.date : null;
  return {
    title,
    date,
    channel: (CHANNELS as readonly string[]).includes(o.channel as string) ? (o.channel as Channel) : "Other",
    type: (TYPES as readonly string[]).includes(o.type as string) ? (o.type as ContentType) : "Post",
    status: (STATUSES as readonly string[]).includes(o.status as string)
      ? (o.status as Status)
      : date
        ? "Planned"
        : "Idea",
    product: String(o.product ?? "").trim().slice(0, 80),
    notes: String(o.notes ?? "").trim().slice(0, 2000),
  };
}

/** Validate a whole stored plan; drops anything malformed. */
export function cleanPlan(x: unknown): Plan | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.items) || !Array.isArray(o.notes)) return null;
  const items: Item[] = [];
  for (const raw of o.items) {
    const d = cleanDraft(raw);
    if (!d) continue;
    const r = raw as Record<string, unknown>;
    items.push({
      ...d,
      id: typeof r.id === "string" && r.id ? r.id.slice(0, 64) : newId(),
      source: r.source === "note" || r.source === "starter" ? r.source : "manual",
      noteId: typeof r.noteId === "string" ? r.noteId.slice(0, 64) : null,
      images: cleanImages(r.images),
      createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
    });
  }
  const notes: Note[] = [];
  for (const raw of o.notes) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const text = String(r.text ?? "").slice(0, 5000);
    const images = cleanImages(r.images);
    if (!text && !images.length) continue;
    notes.push({
      id: typeof r.id === "string" && r.id ? r.id.slice(0, 64) : newId("n"),
      text,
      createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
      organised: Boolean(r.organised),
      itemCount: Number(r.itemCount) || 0,
      images,
    });
  }
  return { items: items.slice(0, 2000), notes: notes.slice(0, 500) };
}

/** Used when the AI organiser isn't set up: one idea per line. */
export function fallbackOrganise(text: string): DraftItem[] {
  return text
    .split(/\n+/)
    .map((s) => s.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean)
    .map((title) => ({
      title: title.slice(0, 160),
      date: null,
      channel: /\b(x|twitter|tweet)\b/i.test(title) ? "X" : "Other",
      type: "Post",
      status: "Idea",
      product: "",
      notes: "",
    }));
}
