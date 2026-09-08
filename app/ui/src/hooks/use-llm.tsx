import { createContext, useContext, type ReactNode } from "react";

import { useApi } from "@/hooks/use-api";

export interface LLMStatus {
  available: boolean;
  model: string;
  provider: string;
  error?: string | null;
}

const LLMStatusContext = createContext<LLMStatus | null>(null);

export function LLMStatusProvider({ children }: { children: ReactNode }) {
  const { data } = useApi<LLMStatus>("/api/admin/llm/status");

  return (
    <LLMStatusContext.Provider value={data}>
      {children}
    </LLMStatusContext.Provider>
  );
}

export function useLLMStatus(): LLMStatus | null {
  return useContext(LLMStatusContext);
}

export function useLLMAvailable(): boolean {
  return useLLMStatus()?.available ?? false;
}
