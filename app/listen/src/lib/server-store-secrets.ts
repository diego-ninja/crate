import {
  getSecureSessionValue,
  removeSecureSessionValue,
  setSecureSessionValue,
} from "@/lib/native-secure-session";
import { isCapacitorRuntime } from "@/lib/platform";

export interface ServerSecret {
  token: string | null;
  refreshToken: string | null;
}

export interface LegacyServerSecretRecord {
  id: string;
  token?: string | null;
  refreshToken?: string | null;
}

const runtimeSecrets = new Map<string, ServerSecret>();
const pendingSecretWrites = new Set<Promise<void>>();

function secureSessionKey(serverId: string): string {
  return `crate.session.${serverId}`;
}

function emptySecret(): ServerSecret {
  return { token: null, refreshToken: null };
}

export function parseServerSecret(value: string | null): ServerSecret {
  if (!value) return emptySecret();
  try {
    const parsed = JSON.parse(value) as Partial<ServerSecret>;
    return {
      token: typeof parsed.token === "string" ? parsed.token : null,
      refreshToken:
        typeof parsed.refreshToken === "string" ? parsed.refreshToken : null,
    };
  } catch {
    return emptySecret();
  }
}

function serializeSecret(secret: ServerSecret): string {
  return JSON.stringify(secret);
}

export function getRuntimeServerSecret(serverId: string): ServerSecret {
  return runtimeSecrets.get(serverId) ?? emptySecret();
}

export function setRuntimeServerSecret(
  serverId: string,
  secret: ServerSecret,
): void {
  runtimeSecrets.set(serverId, secret);
}

export function removeRuntimeServerSecret(serverId: string): void {
  runtimeSecrets.delete(serverId);
}

export function clearRuntimeServerSecrets(): void {
  runtimeSecrets.clear();
}

function trackSecretWrite(operation: Promise<void>): void {
  pendingSecretWrites.add(operation);
  void operation
    .catch(() => undefined)
    .finally(() => pendingSecretWrites.delete(operation));
}

export function queueSecretWrite(serverId: string, secret: ServerSecret): void {
  if (!isCapacitorRuntime) return;
  const operation =
    secret.token || secret.refreshToken
      ? setSecureSessionValue(
          secureSessionKey(serverId),
          serializeSecret(secret),
        )
      : removeSecureSessionValue(secureSessionKey(serverId));
  trackSecretWrite(operation);
}

export function removeQueuedSecret(serverId: string): void {
  if (!isCapacitorRuntime) return;
  void removeSecureSessionValue(secureSessionKey(serverId)).catch(() => {
    // The in-memory session is already removed; a later bootstrap can retry.
  });
}

export async function waitForPendingSecureSessionWrites(): Promise<void> {
  const results = await Promise.allSettled([...pendingSecretWrites]);
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("Native session persistence failed");
  }
}

export async function loadNativeServerSecrets(
  records: readonly LegacyServerSecretRecord[],
): Promise<Map<string, ServerSecret>> {
  const nextSecrets = new Map<string, ServerSecret>();

  for (const server of records) {
    const legacySecret: ServerSecret = {
      token: server.token ?? null,
      refreshToken: server.refreshToken ?? null,
    };
    if (legacySecret.token || legacySecret.refreshToken) {
      const serialized = serializeSecret(legacySecret);
      // Migrate and verify one server secret at a time to keep persistence atomic.
      // react-doctor-disable-next-line async-await-in-loop
      await setSecureSessionValue(secureSessionKey(server.id), serialized);
      const verified = await getSecureSessionValue(secureSessionKey(server.id));
      if (verified !== serialized) {
        throw new Error("Secure session verification failed");
      }
      nextSecrets.set(server.id, legacySecret);
      continue;
    }
    nextSecrets.set(
      server.id,
      parseServerSecret(
        await getSecureSessionValue(secureSessionKey(server.id)),
      ),
    );
  }

  return nextSecrets;
}
