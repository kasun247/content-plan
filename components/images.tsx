"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { newId } from "@/lib/plan";

/**
 * Images attached to notes and items.
 * - Local mode: stored as data URLs in localStorage under `content-plan:img:<id>`.
 * - Cloud mode: PUT to /api/image/<id> (Redis), read back with the same auth as the plan.
 * Every image is resized in the browser first (max 1600px, JPEG), which keeps it small for
 * storage and is also the size Claude reads best.
 */

export type Attachment = { id: string; dataUrl: string; type: string };
export type ImageStore = { mode: "local" | "cloud"; headers: () => Record<string, string> };

const MAX_EDGE = 1600;
const localKey = (id: string) => `content-plan:img:${id}`;

export const ImageCtx = createContext<ImageStore>({ mode: "local", headers: () => ({}) });

/** Resize an image file to a JPEG data URL (transparent areas become white). */
export async function prepareImage(file: File): Promise<Attachment> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`${file.name || "That file"} isn't an image this browser can read.`));
      el.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // JPEG has no transparency
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { id: newId("img"), dataUrl: canvas.toDataURL("image/jpeg", 0.82), type: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

/** Save attachments where the plan lives. Throws with a readable message on failure. */
export async function storeImages(store: ImageStore, list: Attachment[]): Promise<void> {
  for (const a of list) {
    if (store.mode === "local") {
      try {
        localStorage.setItem(localKey(a.id), a.dataUrl);
      } catch {
        throw new Error("This browser is out of space for images. Set up cloud saving to keep more.");
      }
    } else {
      const bytes = Uint8Array.from(atob(base64Of(a.dataUrl)), (c) => c.charCodeAt(0));
      const res = await fetch(`/api/image/${a.id}`, {
        method: "PUT",
        headers: { "content-type": a.type, ...store.headers() },
        body: bytes,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`Couldn't upload the image${body.error ? `: ${body.error}` : ""}.`);
      }
    }
    cache.set(a.id, a.dataUrl);
  }
}

const cache = new Map<string, string>();

/** Resolve an image id to something an <img> can show. */
export function useImageSrc(id: string): string | null | "missing" {
  const store = useContext(ImageCtx);
  const [src, setSrc] = useState<string | null | "missing">(() => cache.get(id) ?? null);
  useEffect(() => {
    if (cache.has(id)) return setSrc(cache.get(id)!);
    let off = false;
    (async () => {
      let out: string | null = null;
      if (store.mode === "local") {
        try {
          out = localStorage.getItem(localKey(id));
        } catch {
          /* storage unavailable */
        }
      } else {
        const res = await fetch(`/api/image/${id}`, { headers: store.headers() }).catch(() => null);
        if (res?.ok) out = URL.createObjectURL(await res.blob());
      }
      if (out) cache.set(id, out);
      if (!off) setSrc(out ?? "missing");
    })();
    return () => {
      off = true;
    };
  }, [id, store]);
  return src;
}

export function Thumb({ id, size, onRemove }: { id: string; size?: number; onRemove?: () => void }) {
  const src = useImageSrc(id);
  return (
    <span className="thumb" style={size ? { width: size, height: size } : undefined}>
      {src && src !== "missing" ? (
        <a href={src} target="_blank" rel="noreferrer" title="Open full size" onClick={(e) => e.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" />
        </a>
      ) : (
        <span className="thumb-missing" title={src === "missing" ? "This image isn't available on this device" : "Loading"}>
          {src === "missing" ? "?" : ""}
        </span>
      )}
      {onRemove && (
        <button type="button" className="thumb-x" aria-label="Remove image" onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}

/** Thumbnail for an attachment that isn't stored yet (composer / dialog preview). */
export function PendingThumb({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  return (
    <span className="thumb" style={{ width: 56, height: 56 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={a.dataUrl} alt="" />
      <button type="button" className="thumb-x" aria-label="Remove image" onClick={onRemove}>
        ×
      </button>
    </span>
  );
}

/** Pull image files out of a paste or drop. */
export function imageFiles(list: DataTransferItemList | FileList | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const x of Array.from(list as ArrayLike<DataTransferItem | File>)) {
    const f = x instanceof File ? x : x.kind === "file" ? x.getAsFile() : null;
    if (f && f.type.startsWith("image/")) out.push(f);
  }
  return out;
}
