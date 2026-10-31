import type { MapArticle } from "./map-api-types";
export function articleNetwork(articles: MapArticle[]) {
  const counts = new Map<string, { id: string; label: string; category: string; count: number }>();
  for (const a of articles)
    for (const m of a.mesh) {
      const old = counts.get(m.id);
      counts.set(m.id, { ...m, count: (old?.count ?? 0) + 1 });
    }
  const mesh = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, 18);
  const n = articles.length + mesh.length,
    positions = Float32Array.from({ length: n * 2 }, (_, k) => {
      const i = Math.floor(k / 2),
        a = i * 2.399963,
        r = 60 + 12 * Math.sqrt(i + 1);
      return k % 2 ? 165 + Math.sin(a) * r : 180 + Math.cos(a) * r;
    });
  const links = articles.flatMap((a, i) =>
    a.mesh.flatMap((m) => {
      const j = mesh.findIndex((t) => t.id === m.id);
      return j < 0 ? [] : [[i, articles.length + j] as [number, number]];
    }),
  );
  for (let step = 0; step < 240; step++) {
    const force = new Float32Array(n * 2);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = positions[i * 2]! - positions[j * 2]!,
          dy = positions[i * 2 + 1]! - positions[j * 2 + 1]!,
          d2 = dx * dx + dy * dy + 1,
          f = 90 / d2;
        force[i * 2] = force[i * 2]! + dx * f;
        force[i * 2 + 1] = force[i * 2 + 1]! + dy * f;
        force[j * 2] = force[j * 2]! - dx * f;
        force[j * 2 + 1] = force[j * 2 + 1]! - dy * f;
      }
    for (const [i, j] of links) {
      const dx = positions[j * 2]! - positions[i * 2]!,
        dy = positions[j * 2 + 1]! - positions[i * 2 + 1]!,
        d = Math.hypot(dx, dy) || 1,
        f = (0.045 * (d - 40)) / d;
      force[i * 2] = force[i * 2]! + dx * f;
      force[i * 2 + 1] = force[i * 2 + 1]! + dy * f;
      force[j * 2] = force[j * 2]! - dx * f;
      force[j * 2 + 1] = force[j * 2 + 1]! - dy * f;
    }
    for (let i = 0; i < n; i++) {
      positions[i * 2] = Math.max(
        30,
        Math.min(
          330,
          positions[i * 2]! +
            Math.max(-3, Math.min(3, force[i * 2]! + (180 - positions[i * 2]!) * 0.055)),
        ),
      );
      positions[i * 2 + 1] = Math.max(
        28,
        Math.min(
          302,
          positions[i * 2 + 1]! +
            Math.max(-3, Math.min(3, force[i * 2 + 1]! + (165 - positions[i * 2 + 1]!) * 0.055)),
        ),
      );
    }
  }
  return { mesh, links, positions };
}
