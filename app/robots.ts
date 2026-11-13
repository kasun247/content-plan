import type { MetadataRoute } from "next";

/** This is a private, single-user plan, so search engines are asked to stay out entirely. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
