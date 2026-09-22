import { Client } from "pg";
import { Period } from "./temporal";
import type { GraphNode, ScienceGraph } from "./science-data";

/** Direct Worker -> Hyperdrive -> PostgreSQL reads. Scientific training stays in Python. */
export async function queryPostgres(connectionString: string, path: string, input?: unknown) {
  const db = new Client({ connectionString });
  await db.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const values = await db.query("SELECT key,value FROM metadata");
    const metadata = Object.fromEntries(values.rows.map((r) => [r.key, JSON.parse(r.value)]));
    const bounds = (
      await db.query(
        "SELECT MIN(year) AS start,MAX(year) AS end,COUNT(*)::int AS articles FROM articles WHERE year IS NOT NULL",
      )
    ).rows[0];
    if (path === "metadata")
      return { ...bounds, revision: metadata.revision, source: metadata.source };
    const { startYear: start, endYear: end } = Period.parse(input);
    if (start < bounds.start || end > bounds.end)
      throw new Error("Período fora do corpus importado.");
    if (path === "graph") {
      const rows = (
        await db.query(
          `SELECT m.*,SUM(n.count)::int AS pubs FROM node_year n JOIN mesh m ON m.id=n.mesh_id
        WHERE n.year BETWEEN $1 AND $2 GROUP BY m.id ORDER BY pubs DESC,m.id LIMIT 4500`,
          [start, end],
        )
      ).rows;
      const ids = rows.map((r) => r.id);
      const edges = (
        await db.query(
          `SELECT mesh_a,mesh_b,SUM(weight)::int AS weight FROM pair_year
        WHERE year BETWEEN $1 AND $2 AND mesh_a=ANY($3::text[]) AND mesh_b=ANY($3::text[])
        GROUP BY mesh_a,mesh_b ORDER BY weight DESC,mesh_a,mesh_b LIMIT 30000`,
          [start, end, ids],
        )
      ).rows;
      const growthRows = (
        await db.query(
          `SELECT mesh_id,SUM(CASE WHEN year >= $1 THEN count ELSE 0 END)::int AS recent,
        SUM(CASE WHEN year < $1 THEN count ELSE 0 END)::int AS older FROM node_year WHERE year BETWEEN $2 AND $3 GROUP BY mesh_id`,
          [end - 4, end - 9, end],
        )
      ).rows;
      const growth = new Map(
        growthRows.map((r) => [
          r.mesh_id,
          Math.max(-2, Math.min(2, Math.log((r.recent + 1) / (r.older + 1)))),
        ]),
      );
      const nodes: GraphNode[] = rows.map((r) => ({
        id: r.id,
        label: r.label,
        cat: r.category,
        tree: r.tree,
        x: r.x,
        y: r.y,
        z: 0,
        hx: r.hx,
        hy: r.hy,
        deg: 0,
        pubs: r.pubs,
        growth: growth.get(r.id) ?? 0,
        growthAvailable: end - 9 >= bounds.start,
        growthReason:
          end - 9 >= bounds.start
            ? null
            : "O corpus não cobre os dez anos necessários às duas janelas de cinco anos.",
      }));
      const indices = new Map(nodes.map((n, i) => [n.id, i]));
      const links = edges.map((r) => {
        const a = indices.get(r.mesh_a)!,
          b = indices.get(r.mesh_b)!;
        nodes[a]!.deg++;
        nodes[b]!.deg++;
        return [a, b, r.weight];
      });
      const counts = (
        await db.query(
          `SELECT (SELECT COUNT(*)::int FROM articles WHERE year BETWEEN $1 AND $2) AS articles,
        (SELECT COUNT(DISTINCT mesh_id)::int FROM node_year WHERE year BETWEEN $1 AND $2) AS concepts`,
          [start, end],
        )
      ).rows[0];
      const template = metadata.template as ScienceGraph;
      return {
        ...template,
        nodes,
        edges: links,
        model: {
          type: "logistic",
          available: false,
          reason: "Execute a inferência para calibrar o modelo neste corte.",
          mean: [],
          std: [],
          coef: [],
          intercept: 0,
        },
        meta: {
          ...template.meta,
          cutoff_year: end,
          corpus_max_year: bounds.end,
          n_nodes: nodes.length,
          n_edges: links.length,
          n_articles: counts.articles,
          period_start: start,
          period_end: end,
          total_concepts: counts.concepts,
          node_limit: 4500,
          edge_limit: 30000,
          revision: metadata.revision,
        },
      };
    }
    const data = input as { meshIds?: string[]; cursor?: string; a?: string; c?: string };
    if (path === "articles") {
      const ids = data.meshIds ?? [];
      if (!ids.length) return { items: [], total: 0, years: [], next: null };
      const filter = `a.year BETWEEN $1 AND $2 AND EXISTS(SELECT 1 FROM article_mesh am WHERE am.pmid=a.pmid AND am.mesh_id=ANY($3::text[]))`;
      const years = (
        await db.query(
          `SELECT a.year,COUNT(*)::int AS count FROM articles a WHERE ${filter} GROUP BY a.year ORDER BY a.year`,
          [start, end, ids],
        )
      ).rows;
      const parts = data.cursor?.split(":");
      const rows = (
        await db.query(
          `SELECT a.* FROM articles a WHERE ${filter} ${parts ? "AND (a.year<$4 OR (a.year=$4 AND a.pmid<$5))" : ""}
        ORDER BY a.year DESC,a.pmid DESC LIMIT 21`,
          [start, end, ids, ...(parts ? [Number(parts[0]), parts[1]] : [])],
        )
      ).rows;
      const items = [];
      for (const row of rows.slice(0, 20)) {
        const mesh = (
          await db.query(
            "SELECT m.id,m.label,m.category,am.major FROM article_mesh am JOIN mesh m ON m.id=am.mesh_id WHERE am.pmid=$1 ORDER BY m.id",
            [row.pmid],
          )
        ).rows;
        items.push({ ...row, authors: row.authors ? JSON.parse(row.authors) : [], mesh });
      }
      return {
        items,
        total: years.reduce((n, r) => n + r.count, 0),
        years,
        next: rows.length > 20 ? `${rows[19].year}:${rows[19].pmid}` : null,
      };
    }
    if (path === "evidence") {
      const ids = [];
      for (const value of [data.a, data.c]) {
        const row = (
          await db.query(
            "SELECT id FROM mesh WHERE id=$1 OR LOWER(label)=LOWER($1) ORDER BY id LIMIT 1",
            [value],
          )
        ).rows[0];
        if (!row) return { a: [], c: [], together: [], bridges: [] };
        ids.push(row.id);
      }
      const articles = async (mid: string) =>
        (
          await db.query(
            `SELECT a.pmid,a.year,a.title FROM articles a JOIN article_mesh am ON am.pmid=a.pmid
        WHERE am.mesh_id=$1 AND a.year BETWEEN $2 AND $3 ORDER BY a.year DESC,a.pmid DESC LIMIT 12`,
            [mid, start, end],
          )
        ).rows;
      const together = (
        await db.query(
          `SELECT a.pmid,a.year,a.title FROM articles a JOIN article_mesh x ON x.pmid=a.pmid JOIN article_mesh y ON y.pmid=a.pmid
        WHERE x.mesh_id=$1 AND y.mesh_id=$2 AND a.year BETWEEN $3 AND $4 ORDER BY a.year,a.pmid LIMIT 20`,
          [...ids, start, end],
        )
      ).rows;
      const neighbours = async (mid: string) =>
        (
          await db.query(
            `SELECT DISTINCT CASE WHEN mesh_a=$1 THEN mesh_b ELSE mesh_a END AS id
        FROM pair_year WHERE (mesh_a=$1 OR mesh_b=$1) AND year BETWEEN $2 AND $3`,
            [mid, start, end],
          )
        ).rows.map((r) => r.id as string);
      const left = await neighbours(ids[0]),
        right = new Set(await neighbours(ids[1]));
      if (data.meshIds && ids.some((id) => !data.meshIds!.includes(id)))
        throw new Error("Conceito fora do universo selecionado");
      const common = left
        .filter((id) => right.has(id) && (!data.meshIds || data.meshIds.includes(id)))
        .sort()
        .slice(0, 6);
      const bridges = (
        await db.query("SELECT label FROM mesh WHERE id=ANY($1::text[]) ORDER BY id", [common])
      ).rows.map((r) => r.label);
      return { a: await articles(ids[0]), c: await articles(ids[1]), together, bridges };
    }
    throw new Error("Consulta SQL não suportada");
  } finally {
    await db.end();
  }
}
