import { useMutation, useQuery } from "@tanstack/react-query";
import { lbdRequest, type LbdRequest } from "@/lib/hypothesis.functions";

export function useLbdJob<T>() {
  const enqueue = useMutation({
    mutationFn: (data: LbdRequest) =>
      lbdRequest({ data: { ...data, requestId: crypto.randomUUID() } }),
  });
  const id = enqueue.data?.id;
  const query = useQuery({
    queryKey: ["lbd-job", id],
    queryFn: () => lbdRequest({ data: { operation: "status", id: id! } }),
    enabled: !!id,
    refetchInterval: (q) =>
      ["pending", "running"].includes(q.state.data?.status ?? "pending") ? 1500 : false,
  });
  return {
    run: enqueue.mutate,
    reset: enqueue.reset,
    pending:
      enqueue.isPending ||
      (!!id && (!query.data || ["pending", "running"].includes(query.data.status ?? ""))),
    result: query.data?.status === "complete" ? (query.data.result as T) : undefined,
    error:
      enqueue.error?.message ?? query.error?.message ?? query.data?.error ?? enqueue.data?.error,
    retry: () => query.refetch(),
  };
}
