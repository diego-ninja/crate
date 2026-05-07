import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";

const allowMixedContent = process.env.CRATE_ALLOW_MIXED_CONTENT === "true";

const config: CapacitorConfig = {
  // Reverse-DNS of the project domain (cratemusic.app). The app itself is
  // just "Crate" — not "Crate Listen" — so the id drops the old ".listen"
  // segment that dated from a time when admin + listen were sibling apps.
  appId: "app.cratemusic.crate",
  appName: "Crate",
  webDir: "dist",

  server: {
    // App loads from local bundle. Auth uses Bearer token (not cookies)
    // so cross-origin is not a problem.
    androidScheme: "https",
    iosScheme: "https",
    allowMixedContent,
  },

  ios: {
    contentInset: "never",
    backgroundColor: "#0a0a0f",
    preferredContentMode: "mobile",
  },

  android: {
    backgroundColor: "#0a0a0f",
    allowMixedContent,
  },

  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 350,
      backgroundColor: "#0a0a0f",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      overlaysWebView: true,
    },
    Keyboard: {
      resize: KeyboardResize.Body,
      style: KeyboardStyle.Dark,
      resizeOnFullScreen: true,
    },
  },
};

export default config;
