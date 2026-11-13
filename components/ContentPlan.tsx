"use client";

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import seed from "@/data/seed.json";
import {
  CHANNELS,
  CHANNEL_COLOR,
  MAX_IMAGES,
  STATUSES,
  STATUS_CLASS,
  STATUS_COLOR,
  TYPES,
  addDays,
  cleanDraft,
  cleanPlan,
  fallbackOrganise,
  fmt,
  newId,
  parseD,
  weekStart,
  ymd,
  type DraftItem,
  type Item,
  type Plan,
  type Status,
} from "@/lib/plan";
import {
  ImageCtx,
  PendingThumb,
  Thumb,
  base64Of,
  imageFiles,
  prepareImage,
  storeImages,
  type Attachment,
  type ImageStore,
} from "./images";

type Mode = "loading" | "local" | "cloud" | "locked";
type View = "timeline" | "board" | "notes";
const VIEWS: View[] = ["timeline", "board", "notes"];
const LOCAL_KEY = "content-plan:v1";
const PASS_KEY = "content-plan:passcode";
type Auth = "google" | "passcode" | null;
const AUTH_ERRORS: Record<string, string> = {
  not_allowed: "That Google account isn't allowed to open this plan. Try another account.",
  cancelled: "Sign-in was cancelled.",
  expired: "Sign-in took too long. Try again.",
  failed: "Google sign-in didn't work. Try again in a minute.",
  not_configured: "Google sign-in isn't set up on the server yet.",
};

const seedPlan = (): Plan => cleanPlan(seed) ?? { items: [], notes: [] };
const byDate = (a: Item, b: Item) =>
  (a.date || "9999").localeCompare(b.date || "9999") || a.createdAt.localeCompare(b.createdAt);

function safeGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export default function ContentPlan() {
  const [mode, setMode] = useState<Mode>("loading");
  const [ai, setAi] = useState(false);
  const [auth, setAuth] = useState<Auth>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>({ items: [], notes: [] });
  const [today, setToday] = useState<Date | null>(null);
  const [view, setView] = useState<View>("timeline");
  const [channelFilter, setChannelFilter] = useState("all");
  const [status, setStatus] = useState<{ msg: string; kind?: "ok" | "err" }>({ msg: "" });
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const passcode = useRef<string>("");
  const dirty = useRef(false);
  const imageStore = useMemo<ImageStore>(
    () => ({
      mode: mode === "cloud" ? "cloud" : "local",
      headers: (): Record<string, string> => (passcode.current ? { "x-plan-passcode": passcode.current } : {}),
    }),
    [mode],
  );

  /* ---------- load ---------- */
  const load = useCallback(async (code: string) => {
    passcode.current = code;
    try {
      const res = await fetch("/api/plan", { headers: code ? { "x-plan-passcode": code } : {}, cache: "no-store" });
      const body = await res.json();
      setAuth((body.auth as Auth) ?? null);
      setEmail(typeof body.email === "string" ? body.email : null);
      if (body.mode === "locked") {
        if (code && body.auth === "passcode") setStatus({ msg: "That passcode didn't work. Try again.", kind: "err" });
        safeSet(PASS_KEY, null);
        setMode("locked");
        return;
      }
      if (!res.ok) throw new Error(body.error || "Couldn't load the plan");
      setAi(Boolean(body.ai));
      if (code) safeSet(PASS_KEY, code);
      if (body.mode === "cloud") {
        const saved = cleanPlan(body.plan);
        if (saved) setPlan(saved);
        else {
          setPlan(seedPlan());
          dirty.current = true; // write the seed so every device starts from the same plan
        }
        setMode("cloud");
      } else {
        const local = cleanPlan(JSON.parse(safeGet(LOCAL_KEY) || "null"));
        setPlan(local ?? seedPlan());
        setMode("local");
      }
      setStatus({ msg: "" });
    } catch {
      const local = cleanPlan(JSON.parse(safeGet(LOCAL_KEY) || "null"));
      setPlan(local ?? seedPlan());
      setMode("local");
      setBanner("The server couldn't be reached, so this plan is being saved in this browser only.");
    }
  }, []);

  useEffect(() => {
    setToday(new Date());
    const params = new URLSearchParams(window.location.search);
    const err = params.get("auth_error");
    if (err) {
      setStatus({ msg: AUTH_ERRORS[err] ?? AUTH_ERRORS.failed, kind: "err" });
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    }
    load(safeGet(PASS_KEY) || "");
  }, [load]);

  /* ---------- save ---------- */
  useEffect(() => {
    if (!dirty.current || mode === "loading" || mode === "locked") return;
    const t = setTimeout(async () => {
      dirty.current = false;
      if (mode === "local") {
        safeSet(LOCAL_KEY, JSON.stringify(plan));
        return;
      }
      try {
        const res = await fetch("/api/plan", {
          method: "PUT",
          headers: { "content-type": "application/json", "x-plan-passcode": passcode.current },
          body: JSON.stringify(plan),
        });
        if (res.status === 401) {
          setMode("locked");
          return;
        }
        if (!res.ok) throw new Error();
        setBanner("");
      } catch {
        dirty.current = true;
        setBanner("Your last change hasn't been saved yet. Check your connection; it will save with your next change.");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [plan, mode]);

  const change = useCallback((fn: (p: Plan) => Plan) => {
    dirty.current = true;
    setPlan(fn);
  }, []);

  /* ---------- routing ---------- */
  useEffect(() => {
    const route = () => {
      const h = window.location.hash.slice(1) as View;
      setView(VIEWS.includes(h) ? h : "timeline");
    };
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);

  /* ---------- derived ---------- */
  const todayStr = today ? ymd(today) : "";
  const thisWeek = today ? ymd(weekStart(today)) : "";
  const isOverdue = useCallback(
    (it: Item) => Boolean(it.date && todayStr && it.date < todayStr && it.status !== "Published"),
    [todayStr],
  );
  const usedChannels = useMemo(() => CHANNELS.filter((c) => plan.items.some((i) => i.channel === c)), [plan.items]);
  const filter = usedChannels.includes(channelFilter as (typeof CHANNELS)[number]) ? channelFilter : "all";
  const visible = useMemo(
    () => plan.items.filter((i) => filter === "all" || i.channel === filter),
    [plan.items, filter],
  );

  /* ---------- actions ---------- */
  const cycle = (id: string) =>
    change((p) => ({
      ...p,
      items: p.items.map((i) =>
        i.id === id ? { ...i, status: STATUSES[(STATUSES.indexOf(i.status) + 1) % STATUSES.length] } : i,
      ),
    }));

  const saveItem = (data: Item) => {
    change((p) => {
      const exists = p.items.some((i) => i.id === data.id);
      return { ...p, items: exists ? p.items.map((i) => (i.id === data.id ? data : i)) : [...p.items, data] };
    });
    flash([data.id]);
  };
  const deleteItem = (id: string) => change((p) => ({ ...p, items: p.items.filter((i) => i.id !== id) }));

  const flash = (ids: string[]) => {
    setFresh(new Set(ids));
    setTimeout(() => setFresh(new Set()), 3000);
  };

  async function organise(e: React.FormEvent) {
    e.preventDefault();
    const text = note.trim();
    const pics = attachments;
    if ((!text && !pics.length) || !today) return;
    setBusy(true);
    setStatus({ msg: pics.length ? "Saving images and reading your note…" : "Reading your note and placing it on the timeline…" });
    const noteId = newId("n");
    const createdAt = new Date().toISOString();
    try {
      await storeImages(imageStore, pics);
    } catch (err) {
      setBusy(false);
      setStatus({ msg: (err as Error).message, kind: "err" });
      return;
    }
    const imageIds = pics.map((a) => a.id);

    let drafts: DraftItem[] | null = null;
    let why = "";
    if (ai) {
      try {
        const existing = [...plan.items]
          .sort(byDate)
          .slice(-40)
          .map((i) => `- ${i.title} | ${i.date || "no date"} | ${i.channel} | ${i.status}`)
          .join("\n");
        const res = await fetch("/api/organise", {
          method: "POST",
          headers: { "content-type": "application/json", "x-plan-passcode": passcode.current },
          body: JSON.stringify({
            text,
            existing,
            images: pics.map((a) => ({ media_type: a.type, data: base64Of(a.dataUrl) })),
            todayIso: ymd(today),
            todayLong: fmt(new Date(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        const arr = (body.items as unknown[]).map(cleanDraft).filter((x): x is DraftItem => x !== null);
        if (arr.length) drafts = arr;
        else why = "I couldn't find any content items in that note.";
      } catch (err) {
        why = (err as Error).message || "Organising didn't work this time.";
      }
    }
    const usedFallback = !drafts;
    if (!drafts) drafts = fallbackOrganise(text);
    if (!drafts.length && pics.length)
      drafts = [{ title: "Image idea", date: null, channel: "Other", type: "Post", status: "Idea", product: "", notes: "" }];

    const newItems: Item[] = drafts.map((d) => ({
      ...d,
      id: newId(),
      source: "note",
      noteId,
      images: imageIds,
      createdAt: new Date().toISOString(),
    }));
    change((p) => ({
      items: [...p.items, ...newItems],
      notes: [{ id: noteId, text, createdAt, organised: !usedFallback, itemCount: newItems.length, images: imageIds }, ...p.notes],
    }));
    flash(newItems.map((i) => i.id));
    setNote("");
    setAttachments([]);
    setBusy(false);
    if (usedFallback) {
      setStatus({
        msg: `${why ? why + " " : ""}Added ${newItems.length} idea${newItems.length === 1 ? "" : "s"}, one per line. Click each to set its date and channel.`,
        kind: why ? "err" : undefined,
      });
    } else {
      const dated = newItems.filter((i) => i.date).length;
      setStatus({
        msg: `Added ${newItems.length} item${newItems.length > 1 ? "s" : ""}${dated ? `, ${dated} with a date` : ""}. Click any item to adjust it.`,
        kind: "ok",
      });
    }
    if (view === "notes") window.location.hash = "timeline";
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    const room = MAX_IMAGES - attachments.length;
    if (room <= 0) {
      setStatus({ msg: `Up to ${MAX_IMAGES} images per note.`, kind: "err" });
      return;
    }
    try {
      const ready = await Promise.all(files.slice(0, room).map(prepareImage));
      setAttachments((a) => [...a, ...ready].slice(0, MAX_IMAGES));
      setStatus(
        files.length > room ? { msg: `Up to ${MAX_IMAGES} images per note, so only the first ${room} were added.`, kind: "err" } : { msg: "" },
      );
    } catch (err) {
      setStatus({ msg: (err as Error).message, kind: "err" });
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setEmail(null);
    setMode("locked");
  }

  /* ---------- render ---------- */
  if (mode === "locked" && auth === "google") {
    return (
      <div className="unlock">
        <h1>
          Content <em>Plan</em>
        </h1>
        <a className="btn google" href="/api/auth/google">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Sign in with Google
        </a>
        <div className={`status-line ${status.kind ?? ""}`}>{status.msg}</div>
      </div>
    );
  }

  if (mode === "locked") {
    return (
      <form
        className="unlock"
        onSubmit={(e) => {
          e.preventDefault();
          const v = (e.currentTarget.elements.namedItem("code") as HTMLInputElement).value;
          setMode("loading");
          load(v);
        }}
      >
        <h1>
          Content <em>Plan</em>
        </h1>
        <label htmlFor="code">Passcode</label>
        <input id="code" name="code" type="password" autoComplete="current-password" required autoFocus />
        <button className="btn primary" type="submit">
          Open plan
        </button>
        <div className={`status-line ${status.kind ?? ""}`}>{status.msg}</div>
      </form>
    );
  }

  const ready = mode !== "loading" && today;

  return (
    <ImageCtx.Provider value={imageStore}>
    <div className="wrap">
      <header className="top">
        <div>
          <h1>
            Content <em>Plan</em>
          </h1>
          <p className="sub">Templates, components and launches for the Framer Marketplace</p>
        </div>
        <div>
          <div className="today">
            {today ? fmt(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""}
          </div>
          {ready && (
            <div className="mode">
              {mode === "cloud" ? "Saved to the cloud" : "Saved in this browser"}
              {ai ? " · AI organising on" : ""}
            </div>
          )}
          {ready && email && (
            <div className="mode">
              {email} ·{" "}
              <button type="button" className="linkish" onClick={signOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {banner && <div className="banner">{banner}</div>}

      <form
        className={`composer${dragging ? " dragging" : ""}`}
        onSubmit={organise}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(imageFiles(e.dataTransfer.files));
        }}
      >
        <label htmlFor="noteInput">Drop a note</label>
        <textarea
          id="noteInput"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onPaste={(e) => {
            const files = imageFiles(e.clipboardData.items);
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          placeholder={
            ai
              ? "e.g. Post Axia launch recap on X Monday. Start teasing template #3 next week. Put Coming Soon on Contra by end of month."
              : "One idea per line, e.g.\nAxia launch recap on X\nTeaser for template #3"
          }
        />
        {attachments.length > 0 && (
          <div className="thumbs">
            {attachments.map((a) => (
              <PendingThumb key={a.id} a={a} onRemove={() => setAttachments((l) => l.filter((x) => x.id !== a.id))} />
            ))}
          </div>
        )}
        <div className="bar">
          <span className="hint">
            {ai
              ? "Write it however it comes, or paste a screenshot. Dates like “Friday” or “next week” are fine."
              : "Each line becomes an idea. Paste or drop images to attach them."}
          </span>
          <div className="bar-actions">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(imageFiles(e.target.files));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => fileInput.current?.click()}
            disabled={busy || !ready || attachments.length >= MAX_IMAGES}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
            Add image
          </button>
          <button type="submit" className="btn primary" disabled={busy || !ready || (!note.trim() && !attachments.length)}>
            {busy ? "Organising…" : "Organise into plan"}
          </button>
          </div>
        </div>
        <div className={`status-line ${status.kind ?? ""}`} role="status" aria-live="polite">
          {status.msg}
        </div>
      </form>

      {ready && <Summary items={visible} todayStr={todayStr} thisWeek={thisWeek} isOverdue={isOverdue} />}

      <div className="toolbar">
        <nav className="tabs" aria-label="Views">
          {VIEWS.map((v) => (
            <a key={v} href={`#${v}`} aria-current={view === v ? "page" : undefined}>
              {v[0].toUpperCase() + v.slice(1)}
            </a>
          ))}
        </nav>
        <div className="tools">
          <select aria-label="Filter by channel" value={filter} onChange={(e) => setChannelFilter(e.target.value)}>
            <option value="all">All channels</option>
            {usedChannels.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button className="btn" type="button" onClick={() => setEditing("new")} disabled={!ready}>
            Add item
          </button>
        </div>
      </div>

      <main>
        {!ready ? (
          <Blank title="Loading your plan…">One moment.</Blank>
        ) : view === "notes" ? (
          <Notes plan={plan} />
        ) : visible.length === 0 ? (
          filter !== "all" ? (
            <Blank title={`Nothing for ${filter}`}>Pick “All channels” to see everything.</Blank>
          ) : (
            <Blank title="Your plan is empty">Drop a note above and it becomes dated items on this timeline.</Blank>
          )
        ) : view === "board" ? (
          <Board items={visible} isOverdue={isOverdue} onEdit={setEditing} />
        ) : (
          <Timeline
            items={visible}
            thisWeek={thisWeek}
            isOverdue={isOverdue}
            fresh={fresh}
            onEdit={setEditing}
            onCycle={cycle}
          />
        )}
      </main>

      {editing && (
        <EditDialog
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(it) => {
            saveItem(it);
            setEditing(null);
          }}
          onDelete={(id) => {
            deleteItem(id);
            setEditing(null);
          }}
        />
      )}
    </div>
    </ImageCtx.Provider>
  );
}

/* ---------- pieces ---------- */

function Blank({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="blank">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function Summary({
  items,
  todayStr,
  thisWeek,
  isOverdue,
}: {
  items: Item[];
  todayStr: string;
  thisWeek: string;
  isOverdue: (i: Item) => boolean;
}) {
  const weekEnd = ymd(addDays(parseD(thisWeek), 6));
  const dueWeek = items.filter((i) => i.date && i.date >= todayStr && i.date <= weekEnd && i.status !== "Published").length;
  const over = items.filter(isOverdue).length;
  return (
    <section className="summary" aria-label="Plan summary">
      {STATUSES.map((s) => (
        <div className="stat" key={s}>
          <b>{items.filter((i) => i.status === s).length}</b>
          <span>
            <i className="dot" style={{ background: STATUS_COLOR[s] }} />
            {s}
          </span>
        </div>
      ))}
      <div className="stat">
        <b>{dueWeek}</b>
        <span>Left this week</span>
      </div>
      <div className={`stat${over ? " warn" : ""}`}>
        <b>{over}</b>
        <span>Overdue</span>
      </div>
    </section>
  );
}

function ChannelTag({ channel }: { channel: Item["channel"] }) {
  return (
    <span className="ch" style={{ ["--chc" as string]: CHANNEL_COLOR[channel] }}>
      <i />
      {channel}
    </span>
  );
}

function Row({
  it,
  overdue,
  fresh,
  onEdit,
  onCycle,
}: {
  it: Item;
  overdue: boolean;
  fresh: boolean;
  onEdit: (i: Item) => void;
  onCycle: (id: string) => void;
}) {
  const d = it.date ? parseD(it.date) : null;
  const cls = ["row", overdue && "overdue", it.status === "Published" && "done", fresh && "fresh"].filter(Boolean).join(" ");
  return (
    <li className={cls}>
      {d ? (
        <div className="when">
          <span className="dow">{fmt(d, { weekday: "short" })}</span>
          <span className="dnum">{d.getDate()}</span>
        </div>
      ) : (
        <div className="when nodate">
          <span className="dnum">—</span>
        </div>
      )}
      <button className="main" type="button" onClick={() => onEdit(it)}>
        <span className="title">{it.title}</span>
        <span className="meta">
          <ChannelTag channel={it.channel} />
          <span>{it.type}</span>
          {it.product && <span>{it.product}</span>}
          {overdue && d && <span className="late">Overdue · {fmt(d, { day: "numeric", month: "short" })}</span>}
          {it.source === "starter" && <span className="tag">example</span>}
        </span>
      </button>
      {it.images.length > 0 && (
        <span className="row-thumb">
          <Thumb id={it.images[0]} size={40} />
          {it.images.length > 1 && <span className="more">+{it.images.length - 1}</span>}
        </span>
      )}
      <button
        className={`pill ${STATUS_CLASS[it.status]}`}
        type="button"
        title="Click to move to the next status"
        onClick={() => onCycle(it.id)}
      >
        {it.status}
      </button>
    </li>
  );
}

function Timeline({
  items,
  thisWeek,
  isOverdue,
  fresh,
  onEdit,
  onCycle,
}: {
  items: Item[];
  thisWeek: string;
  isOverdue: (i: Item) => boolean;
  fresh: Set<string>;
  onEdit: (i: Item) => void;
  onCycle: (id: string) => void;
}) {
  const wk = (s: string) => ymd(weekStart(parseD(s)));
  const over = items.filter(isOverdue).sort(byDate);
  const past = items.filter((i) => i.date && wk(i.date) < thisWeek && !isOverdue(i)).sort(byDate).reverse();
  const upcoming = items.filter((i) => i.date && wk(i.date) >= thisWeek && !isOverdue(i)).sort(byDate);
  const undated = items.filter((i) => !i.date).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const weeks = new Map<string, Item[]>([[thisWeek, []]]);
  for (const i of upcoming) {
    const k = wk(i.date as string);
    if (!weeks.has(k)) weeks.set(k, []);
    weeks.get(k)!.push(i);
  }
  const next = ymd(addDays(parseD(thisWeek), 7));
  const row = (it: Item) => (
    <Row key={it.id} it={it} overdue={isOverdue(it)} fresh={fresh.has(it.id)} onEdit={onEdit} onCycle={onCycle} />
  );

  return (
    <div className="stack weeks">
      {over.length > 0 && (
        <section className="week">
          <div className="week-head">
            <h2>Overdue</h2>
            <span className="badge red">{over.length}</span>
          </div>
          <ul className="rows">{over.map(row)}</ul>
        </section>
      )}
      {[...weeks.keys()].sort().map((k) => {
        const s = parseD(k);
        const list = weeks.get(k)!;
        const label = k === thisWeek ? "This week" : k === next ? "Next week" : `Week of ${fmt(s, { day: "numeric", month: "short" })}`;
        return (
          <section className="week" key={k}>
            <div className="week-head">
              <h2>{label}</h2>
              <span className="range">
                {fmt(s, { day: "numeric", month: "short" })} – {fmt(addDays(s, 6), { day: "numeric", month: "short" })}
              </span>
              {k === thisWeek && <span className="badge">Now</span>}
            </div>
            <ul className="rows">
              {list.length ? list.map(row) : <li className="empty-week">Nothing dated this week yet. Drop a note above.</li>}
            </ul>
          </section>
        );
      })}
      {undated.length > 0 && (
        <section className="week">
          <div className="week-head">
            <h2>No date yet</h2>
            <span className="range">
              {undated.length} idea{undated.length > 1 ? "s" : ""}
            </span>
          </div>
          <ul className="rows">{undated.map(row)}</ul>
        </section>
      )}
      {past.length > 0 && (
        <details className="earlier">
          <summary>Earlier · {past.length} done</summary>
          <ul className="rows">{past.map(row)}</ul>
        </details>
      )}
    </div>
  );
}

function Board({
  items,
  isOverdue,
  onEdit,
}: {
  items: Item[];
  isOverdue: (i: Item) => boolean;
  onEdit: (i: Item) => void;
}) {
  return (
    <div className="board">
      {STATUSES.map((s) => {
        const list = items.filter((i) => i.status === s).sort(byDate);
        return (
          <div className="col" key={s}>
            <h3>
              <span style={{ color: STATUS_COLOR[s] }}>{s}</span>
              <span className="n">{list.length}</span>
            </h3>
            {list.length ? (
              list.map((it) => (
                <button type="button" key={it.id} className={`card${isOverdue(it) ? " overdue" : ""}`} onClick={() => onEdit(it)}>
                  {it.images.length > 0 && <CardImage id={it.images[0]} />}
                  <span className="title">{it.title}</span>
                  <span className="meta">
                    <ChannelTag channel={it.channel} />
                    {it.product && <span>{it.product}</span>}
                  </span>
                  <span className="d">
                    {it.date ? fmt(parseD(it.date), { weekday: "short", day: "numeric", month: "short" }) : "No date"}
                  </span>
                </button>
              ))
            ) : (
              <div className="none">Nothing here</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CardImage({ id }: { id: string }) {
  return (
    <span className="card-img">
      <Thumb id={id} />
    </span>
  );
}

function Notes({ plan }: { plan: Plan }) {
  if (!plan.notes.length)
    return (
      <Blank title="No notes yet">
        Every note you drop in is kept here, so you can see where each plan item came from.
      </Blank>
    );
  return (
    <div className="stack">
      {plan.notes.map((n) => {
        const d = new Date(n.createdAt);
        const st = n.organised
          ? `organised into ${n.itemCount} item${n.itemCount === 1 ? "" : "s"}`
          : `added as ${n.itemCount} idea${n.itemCount === 1 ? "" : "s"}`;
        return (
          <article className="note" key={n.id}>
            <span className="nm">
              {fmt(d, { day: "numeric", month: "short" })} ·{" "}
              {d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {st}
            </span>
            {n.text && <p>{n.text}</p>}
            {n.images.length > 0 && (
              <div className="thumbs">
                {n.images.map((id) => (
                  <Thumb key={id} id={id} size={72} />
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function EditDialog({
  item,
  onClose,
  onSave,
  onDelete,
}: {
  item: Item | null;
  onClose: () => void;
  onSave: (it: Item) => void;
  onDelete: (id: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const store = useContext(ImageCtx);
  const [armed, setArmed] = useState(false);
  const [images, setImages] = useState<string[]>(item?.images ?? []);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const room = MAX_IMAGES - images.length - pending.length;
  const addFiles = async (files: File[]) => {
    try {
      const ready = await Promise.all(files.slice(0, Math.max(0, room)).map(prepareImage));
      setPending((p) => [...p, ...ready]);
      setErr(files.length > room ? `Up to ${MAX_IMAGES} images per item.` : "");
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const [f, setF] = useState(() => ({
    title: item?.title ?? "",
    date: item?.date ?? "",
    status: (item?.status ?? "Idea") as Status,
    channel: item?.channel ?? "X",
    type: item?.type ?? "Post",
    product: item?.product ?? "",
    notes: item?.notes ?? "",
  }));

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}>
      <form
        className="dlg"
        onSubmit={async (e) => {
          e.preventDefault();
          const title = f.title.trim();
          if (!title || saving) return;
          setSaving(true);
          try {
            await storeImages(store, pending);
          } catch (e2) {
            setErr((e2 as Error).message);
            setSaving(false);
            return;
          }
          onSave({
            id: item?.id ?? newId(),
            title,
            date: f.date || null,
            status: f.status,
            channel: f.channel,
            type: f.type,
            product: f.product.trim(),
            notes: f.notes.trim(),
            source: item?.source ?? "manual",
            noteId: item?.noteId ?? null,
            images: [...images, ...pending.map((a) => a.id)],
            createdAt: item?.createdAt ?? new Date().toISOString(),
          });
        }}
      >
        <h2>{item ? "Edit item" : "Add item"}</h2>
        <div className="field">
          <label htmlFor="fTitle">Title</label>
          <input id="fTitle" required maxLength={160} autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="fDate">Date</label>
            <input id="fDate" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="fStatus">Status</label>
            <select id="fStatus" value={f.status} onChange={(e) => set("status", e.target.value as Status)}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fChannel">Channel</label>
            <select id="fChannel" value={f.channel} onChange={(e) => set("channel", e.target.value as Item["channel"])}>
              {CHANNELS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fType">Type</label>
            <select id="fType" value={f.type} onChange={(e) => set("type", e.target.value as Item["type"])}>
              {TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="fProduct">Template or component</label>
          <input id="fProduct" maxLength={80} placeholder="e.g. Axia" value={f.product} onChange={(e) => set("product", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="fNotes">Notes</label>
          <textarea
            id="fNotes"
            maxLength={2000}
            value={f.notes}
            onChange={(e) => set("notes", e.target.value)}
            onPaste={(e) => {
              const files = imageFiles(e.clipboardData.items);
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
          />
        </div>
        <div className="field">
          <span className="label">Images</span>
          <div className="thumbs">
            {images.map((id) => (
              <Thumb key={id} id={id} size={56} onRemove={() => setImages((l) => l.filter((x) => x !== id))} />
            ))}
            {pending.map((a) => (
              <PendingThumb key={a.id} a={a} onRemove={() => setPending((l) => l.filter((x) => x.id !== a.id))} />
            ))}
            {room > 0 && (
              <button type="button" className="thumb-add" onClick={() => fileInput.current?.click()} aria-label="Add image">
                +
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(imageFiles(e.target.files));
              e.target.value = "";
            }}
          />
          {err && <div className="status-line err">{err}</div>}
        </div>
        <div className="actions">
          {item ? (
            <button
              type="button"
              className={`btn danger${armed ? " armed" : ""}`}
              onClick={() => (armed ? onDelete(item.id) : setArmed(true))}
            >
              {armed ? "Confirm delete" : "Delete"}
            </button>
          ) : (
            <span />
          )}
          <div>
            <button type="button" className="btn" onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
