import type { CapacitorConfig } from "@capacitor/cli";

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
    allowMixedContent: true,
  },

  ios: {
    contentInset: "always",
    backgroundColor: "#0a0a0f",
    preferredContentMode: "mobile",
  },

  android: {
    backgroundColor: "#0a0a0f",
    allowMixedContent: true,
  },

  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 800,
      backgroundColor: "#0a0a0f",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      overlaysWebView: true,
    },
  },
};

export default config;
