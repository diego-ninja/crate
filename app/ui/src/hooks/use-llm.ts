import { useApi } from "@/hooks/use-api";

interface LLMStatus {
  available: boolean;
  model: string;
  provider: string;
}

export function useLLMAvailable(): boolean {
  const { data } = useApi<LLMStatus>("/api/admin/llm/status");
  return data?.available ?? false;
}
