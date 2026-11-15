export type Point = { lat: number; lng: number };

export type LyftLinks = { app: string; web: string };

const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6);

/**
 * Lyft deep link plus its web fallback, destination prefilled. This opens Lyft with the trip ready;
 * it cannot pick the ride type or apply the USC pass (the student picks Shared in the app).
 * Pickup is optional: without it Lyft uses the phone's current location.
 */
export function lyftLinks(dest: Point, pickup?: Point | null): LyftLinks {
  const q = [
    "id=lyft",
    ...(pickup ? [`pickup[latitude]=${fmt(pickup.lat)}`, `pickup[longitude]=${fmt(pickup.lng)}`] : []),
    `destination[latitude]=${fmt(dest.lat)}`,
    `destination[longitude]=${fmt(dest.lng)}`,
  ].join("&");
  return { app: `lyft://ridetype?${q}`, web: `https://lyft.com/ride?${q}` };
}

/**
 * Try the app first. If the page is still visible shortly after (app not installed), fall back to the
 * web link in the same tab; an async window.open would be blocked as a popup on iOS Safari.
 */
export function openLyft(links: LyftLinks, waitMs = 1500): void {
  const onHide = () => {
    if (document.hidden) clearTimeout(timer);
  };
  const timer = setTimeout(() => {
    document.removeEventListener("visibilitychange", onHide);
    if (!document.hidden) window.location.assign(links.web);
  }, waitMs);
  document.addEventListener("visibilitychange", onHide, { once: true });
  window.location.href = links.app;
}
