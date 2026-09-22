// The Worker only schedules durable jobs; XML is processed by the SQL service.
interface Env {
  PUBMED_JOBS: { send(body: { id: string }): Promise<void> };
  INGESTION_API_URL: string;
  INGESTION_API_TOKEN: string;
}
export default {
  async scheduled(event: { scheduledTime: number }, env: Env) {
    await env.PUBMED_JOBS.send({
      id: `pubmed-${new Date(event.scheduledTime).toISOString().slice(0, 10)}`,
    });
  },
  async queue(
    batch: { messages: { body: { id: string }; ack(): void; retry(): void }[] },
    env: Env,
  ) {
    for (const message of batch.messages) {
      try {
        const response = await fetch(`${env.INGESTION_API_URL.replace(/\/$/, "")}/ingestion-jobs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.INGESTION_API_TOKEN}`,
          },
          body: JSON.stringify({ id: message.body.id }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error("Job not accepted");
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
};
