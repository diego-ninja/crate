import { fetchActiveConnectSession } from "@/lib/crate-connect";
import { crateConnectTargetProvider } from "./playback-target-connect";
import { googleCastTargetProvider } from "./playback-target-cast";
import { localTargetProvider } from "./playback-target-local";
import { nativeOutputRouteProvider } from "./playback-target-native";
import type {
  PlaybackTarget,
  PlaybackTargetContext,
  PlaybackTargetGroup,
  PlaybackTargetProvider,
  PlaybackTargetSelectionResult,
} from "./playback-target-types";

export type {
  PlaybackTarget,
  PlaybackTargetCapabilities,
  PlaybackTargetConnectContext,
  PlaybackTargetConnectInstance,
  PlaybackTargetContext,
  PlaybackTargetGroup,
  PlaybackTargetKind,
  PlaybackTargetProvider,
  PlaybackTargetSelectionResult,
} from "./playback-target-types";

export {
  crateConnectTargetProvider,
  googleCastTargetProvider,
  localTargetProvider,
  nativeOutputRouteProvider,
};

export const playbackTargetProviders: PlaybackTargetProvider[] = [
  localTargetProvider,
  nativeOutputRouteProvider,
  googleCastTargetProvider,
  crateConnectTargetProvider,
];

function isProviderList(
  value: PlaybackTargetContext | PlaybackTargetProvider[] | undefined,
): value is PlaybackTargetProvider[] {
  return Array.isArray(value);
}

function targetArgs(
  contextOrProviders?: PlaybackTargetContext | PlaybackTargetProvider[],
  providers?: PlaybackTargetProvider[],
): {
  context?: PlaybackTargetContext;
  providers: PlaybackTargetProvider[];
} {
  if (isProviderList(contextOrProviders)) {
    return { providers: contextOrProviders };
  }
  return {
    context: contextOrProviders,
    providers: providers ?? playbackTargetProviders,
  };
}

async function enrichTargetContext(
  context: PlaybackTargetContext | undefined,
): Promise<PlaybackTargetContext | undefined> {
  if (context?.connect?.transport === "ws") return context;
  if (context?.activeConnectDeviceId !== undefined) return context;
  const session = await fetchActiveConnectSession().catch(() => null);
  return {
    ...context,
    activeConnectDeviceId: session?.active_device_id ?? null,
    activeConnectSession: session,
  };
}

export async function loadPlaybackTargetGroups(
  contextOrProviders?: PlaybackTargetContext | PlaybackTargetProvider[],
  providersArg?: PlaybackTargetProvider[],
): Promise<PlaybackTargetGroup[]> {
  const { context, providers } = targetArgs(contextOrProviders, providersArg);
  const enrichedContext = await enrichTargetContext(context);
  const groups = await Promise.all(
    providers.map(async (provider) => {
      try {
        const targets = await provider.getTargets(enrichedContext);
        return {
          providerId: provider.id,
          label: provider.label,
          targets,
        };
      } catch {
        return {
          providerId: provider.id,
          label: provider.label,
          targets: [],
          error: "Targets unavailable",
        };
      }
    }),
  );
  return groups.filter((group) => group.targets.length > 0 || group.error);
}

export async function selectPlaybackTarget(
  target: PlaybackTarget,
  contextOrProviders?: PlaybackTargetContext | PlaybackTargetProvider[],
  providersArg?: PlaybackTargetProvider[],
): Promise<PlaybackTargetSelectionResult> {
  const { context, providers } = targetArgs(contextOrProviders, providersArg);
  const provider = providers.find((item) => item.id === target.providerId);
  if (!provider) {
    return { ok: false, message: "Output target provider is unavailable." };
  }
  return provider.selectTarget(target, context);
}
