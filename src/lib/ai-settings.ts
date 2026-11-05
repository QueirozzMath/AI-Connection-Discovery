import { z } from "zod";
export const AiSettingsSchema = z.object({
  mode: z.enum(["free", "personal", "custom"]).default("free"),
  provider: z.enum(["gemini", "openai", "anthropic", "openrouter"]).default("gemini"),
  model: z.string().trim().max(200).default(""),
  baseUrl: z.string().trim().max(500).default(""),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;
export const defaultAiSettings: AiSettings = {
  mode: "free",
  provider: "gemini",
  model: "",
  baseUrl: "",
};
export type AiAttempt = { provider: string; model: string; outcome: string; elapsedMs: number };
export type AiProvenance = {
  provider: string;
  model: string;
  mode: AiSettings["mode"];
  attempts: AiAttempt[];
};
