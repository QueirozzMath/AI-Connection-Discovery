declare module "cloudflare:workers" {
  export const env: {
    AI?: import("./lib/agent-provider.server").AgentBinding;
    AI_MODEL?: string;
    HYPERDRIVE?: { connectionString: string };
  };
}
