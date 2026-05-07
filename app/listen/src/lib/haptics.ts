import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

import { isNative } from "@/lib/capacitor-runtime";

type HapticFeedback = "light" | "medium" | "selection" | "success" | "warning" | "error";

export function triggerHaptic(feedback: HapticFeedback = "light"): void {
  if (!isNative) return;

  const run = async () => {
    switch (feedback) {
      case "selection":
        await Haptics.selectionStart();
        await Haptics.selectionChanged();
        await Haptics.selectionEnd();
        return;
      case "medium":
        await Haptics.impact({ style: ImpactStyle.Medium });
        return;
      case "success":
        await Haptics.notification({ type: NotificationType.Success });
        return;
      case "warning":
        await Haptics.notification({ type: NotificationType.Warning });
        return;
      case "error":
        await Haptics.notification({ type: NotificationType.Error });
        return;
      default:
        await Haptics.impact({ style: ImpactStyle.Light });
    }
  };

  void run().catch(() => {});
}
