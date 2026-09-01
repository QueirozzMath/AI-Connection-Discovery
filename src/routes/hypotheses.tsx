import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useMemo, useState } from "react";
import { z } from "zod";
import { BrainCircuit, FlaskConical, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { candidatesQuery, pct, type Candidate } from "@/lib/science-data";
import { generateHypothesis, type HypothesisResult } from "@/lib/hypothesis.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";

const searchSchema = z.object({ a: z.string().optional(), c: z.string().optional() });

export const Route = createFileRoute("/hypotheses")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Agentes de hipótese — MeSHMap" },
      {
        name: "description",
        content:
          "Agentes de IA leem apenas a literatura de cada conceito e formulam hipóteses mecanísticas para conexões inéditas, com crítica cética.",
      },
      { property: "og:title", content: "Agentes de hipótese — MeSHMap" },
      {
        property: "og:description",
        content:
          "Hipóteses geradas por IA para conexões inéditas entre MeSH terms, com revisão cética e avaliação de acerto.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(candidatesQuery),
  component: () => (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Carregando pares…</div>}>
      <HypothesesPage />
    </Suspense>
  ),
});

function HypothesesPage() {
  const { data } = useSuspenseQuery(candidatesQuery);
  const search = Route.useSearch();
  const run = useServerFn(generateHypothesis);

  const initial = useMemo(() => {
    if (search.a && search.c) {
      return data.items.find((i) => i.a === search.a && i.c === search.c) ?? data.items[0]!;
    }
    return data.items[0]!;
  }, [data.items, search.a, search.c]);

  const [pair, setPair] = useState<Candidate>(initial);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Record<string, HypothesisResult>>({});

  const key = `${pair.a}::${pair.c}`;
  const result = results[key];

  const generate = async () => {
    setLoading(true);
    try {
      const res = await run({
        data: {
          a: pair.a,
          c: pair.c,
          intermediaries: pair.intermediaries,
          prob: pair.prob,
          cutoffYear: 2021,
        },
      });
      setResults((r) => ({ ...r, [key]: res }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao gerar hipótese");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="w-full shrink-0 border-b border-border bg-sidebar p-4 lg:h-full lg:w-80 lg:border-b-0 lg:border-r">
        <h1 className="font-display text-lg font-semibold">Agentes de hipótese</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Cada agente vê apenas os conceitos-ponte e a literatura anterior ao ano de corte.
        </p>
        <ScrollArea className="mt-3 h-[calc(100%-5rem)] rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {data.items.slice(0, 80).map((c) => (
              <li key={`${c.a}-${c.c}`}>
                <button
                  onClick={() => setPair(c)}
                  className="w-full px-3 py-2.5 text-left text-xs transition-colors hover:bg-secondary"
                  data-active={c === pair}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-muted-foreground">#{c.rank}</span>
                    <span className="font-mono text-[11px] text-primary">{pct(c.prob, 0)}</span>
                  </div>
                  <p className="mt-1 leading-snug">
                    {c.a} <span className="text-muted-foreground">⇢</span> {c.c}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </aside>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <section className="panel p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">#{pair.rank}</Badge>
              {pair.confirmed ? (
                <Badge className="bg-accent text-accent-foreground">
                  confirmada em {pair.first_year} (+{pair.lead_time_years} anos)
                </Badge>
              ) : (
                <Badge variant="outline">ainda não observada</Badge>
              )}
              <Badge variant="outline">p = {pct(pair.prob)}</Badge>
            </div>
            <h2 className="mt-3 font-display text-xl font-semibold">
              {pair.a} <span className="text-muted-foreground">⇢</span> {pair.c}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Conceitos-ponte: {pair.intermediaries.join(", ")}
            </p>
            <Progress value={pair.prob * 100} className="mt-4" />
            <Button onClick={generate} disabled={loading} className="mt-4">
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Agentes trabalhando…
                </>
              ) : (
                <>
                  <BrainCircuit className="size-4" /> {result ? "Regerar" : "Gerar"} hipótese
                </>
              )}
            </Button>
          </section>

          {result && (
            <>
              <section className="panel p-5">
                <h3 className="font-display text-lg font-semibold">{result.title}</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline">confiança {pct(result.confidence, 0)}</Badge>
                  <Badge variant="outline">novidade {result.novelty}</Badge>
                  <Badge variant="secondary">{result.model}</Badge>
                </div>
                <Block title="Hipótese" body={result.hypothesis} />
                <Block title="Mecanismo proposto" body={result.mechanism} />
                <Block title="Raciocínio pela ponte B" body={result.bridge_reasoning} />
              </section>

              <section className="panel p-5">
                <h3 className="flex items-center gap-2 font-display text-base font-semibold">
                  <FlaskConical className="size-4 text-primary" /> Previsão testável
                </h3>
                <p className="mt-2 text-sm leading-relaxed">{result.testable_prediction}</p>
              </section>

              <section className="panel p-5">
                <h3 className="flex items-center gap-2 font-display text-base font-semibold">
                  <ShieldAlert className="size-4 text-destructive" /> Agente cético
                </h3>
                <p className="mt-2 text-sm leading-relaxed">{result.skeptic_critique}</p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-1 text-sm leading-relaxed">{body}</p>
    </div>
  );
}
