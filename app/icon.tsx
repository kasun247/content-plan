import { ImageResponse } from "next/og";
import { Mark } from "@/lib/brand";

export const contentType = "image/png";

const SIZES = [32, 192, 512];

export function generateImageMetadata() {
  return SIZES.map((s) => ({ id: String(s), size: { width: s, height: s }, contentType }));
}

export default async function Icon({ id }: { id: Promise<string> | string }) {
  const s = Number(await id) || 32;
  return new ImageResponse(<Mark size={s} />, { width: s, height: s });
}
