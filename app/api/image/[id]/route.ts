import { NextResponse } from "next/server";
import { isImageId } from "@/lib/plan";
import { authorised, cloudEnabled, readImage, writeImage } from "@/lib/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 1_500_000; // the client resizes to ~1600px JPEG first, so real images are far smaller

/** GET → the image bytes (signed in only). */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!isImageId(id)) return NextResponse.json({ error: "Bad image id" }, { status: 400 });
  if (!cloudEnabled()) return NextResponse.json({ error: "Cloud saving is not set up" }, { status: 400 });
  if (!authorised(req)) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const img = await readImage(id);
    if (!img) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new Response(new Uint8Array(img.bytes), {
      headers: {
        "content-type": img.type,
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** PUT raw image bytes with a Content-Type header. Ids are random, so they're never overwritten in practice. */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!isImageId(id)) return NextResponse.json({ error: "Bad image id" }, { status: 400 });
  if (!cloudEnabled()) return NextResponse.json({ error: "Cloud saving is not set up" }, { status: 400 });
  if (!authorised(req)) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!TYPES.includes(type)) return NextResponse.json({ error: "Only JPEG, PNG, WebP or GIF" }, { status: 415 });
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) return NextResponse.json({ error: "Empty image" }, { status: 400 });
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "Image is too large" }, { status: 413 });
  try {
    await writeImage(id, type, bytes);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
