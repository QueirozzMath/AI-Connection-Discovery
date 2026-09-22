/** Only this server module knows the private query service address and token. */
export async function queryMapService<T>(
  path: "metadata" | "graph" | "articles",
  body?: unknown,
): Promise<T> {
  const base = process.env["MAP_API_URL"] ?? (import.meta.env.DEV ? "http://127.0.0.1:8090" : "");
  if (!base) throw new Error("A consulta de artigos e períodos está indisponível neste ambiente.");
  const token = process.env["MAP_API_TOKEN"];
  const response = await fetch(`${base.replace(/\/$/, "")}/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error("Não foi possível consultar os dados do mapa. Tente novamente.");
  return response.json() as Promise<T>;
}
