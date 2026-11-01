import { defaultAiSettings, type AiSettings } from "@/lib/ai-settings";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  emptySession,
  restoreSession,
  serializeSession,
  selectSession,
  type AgentSession,
  type AgentSelection,
} from "@/lib/agent-session";
import type { HypothesisResult, VerificationResult } from "@/lib/hypothesis.functions";
const Context = createContext<{
  state: AgentSession;
  hydrated: boolean;
  select: (selection: AgentSelection) => void;
  setResults: (update: SetStateAction<Record<string, HypothesisResult>>) => void;
  setChecks: (update: SetStateAction<Record<string, VerificationResult>>) => void;
  saveTranslation: (
    key: string,
    value: { result?: HypothesisResult; check?: VerificationResult },
    source: {
      key: string;
      result: HypothesisResult | undefined;
      check: VerificationResult | undefined;
    },
  ) => void;
  ai: AiSettings;
  setAi: (settings: AiSettings) => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  pending: Record<string, boolean>;
  setPending: (key: string, value: boolean) => void;
}>(null!);
export const useAgentSession = () => useContext(Context);
export function AgentSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AgentSession>(emptySession);
  const [hydrated, setHydrated] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [ai, setAi] = useState<AiSettings>(defaultAiSettings);
  const [pending, setPendingState] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      setState(restoreSession(sessionStorage.getItem("discovery-agents-session-v1")));
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated)
      try {
        sessionStorage.setItem("discovery-agents-session-v1", serializeSession(state));
      } catch {}
  }, [state, hydrated]);
  const select = useCallback(
    (selection: AgentSelection) => setState((s) => selectSession(s, selection)),
    [],
  );
  const setResults = useCallback(
    (update: SetStateAction<Record<string, HypothesisResult>>) =>
      setState((s) => ({
        ...s,
        results: typeof update === "function" ? update(s.results) : update,
        translations: {},
      })),
    [],
  );
  const setChecks = useCallback(
    (update: SetStateAction<Record<string, VerificationResult>>) =>
      setState((s) => ({
        ...s,
        checks: typeof update === "function" ? update(s.checks) : update,
        translations: {},
      })),
    [],
  );
  const saveTranslation = useCallback(
    (
      key: string,
      value: { result?: HypothesisResult; check?: VerificationResult },
      source: {
        key: string;
        result: HypothesisResult | undefined;
        check: VerificationResult | undefined;
      },
    ) =>
      setState((s) =>
        s.results[source.key] !== source.result || s.checks[source.key] !== source.check
          ? s
          : { ...s, translations: { ...s.translations, [key]: value } },
      ),
    [],
  );
  const setPending = useCallback(
    (key: string, value: boolean) => setPendingState((s) => ({ ...s, [key]: value })),
    [],
  );
  return (
    <Context.Provider
      value={{
        state,
        hydrated,
        select,
        setResults,
        setChecks,
        saveTranslation,
        ai,
        setAi,
        apiKey,
        setApiKey,
        pending,
        setPending,
      }}
    >
      {children}
    </Context.Provider>
  );
}
