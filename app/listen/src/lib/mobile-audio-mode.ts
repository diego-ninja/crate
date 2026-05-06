import { isAndroidRuntime, isIosRuntime } from "@/lib/capacitor-runtime";
import { getMobileEnhancedAudioPreference } from "@/lib/player-playback-prefs";

export const isMobileAudioRuntime = isAndroidRuntime || isIosRuntime;
export const mobileEnhancedAudioEnabledAtStartup =
  isMobileAudioRuntime && getMobileEnhancedAudioPreference();
export const stableMobileAudioPipeline =
  isMobileAudioRuntime && !mobileEnhancedAudioEnabledAtStartup;
export const canUseWebAudioEffects =
  !isMobileAudioRuntime || mobileEnhancedAudioEnabledAtStartup;
