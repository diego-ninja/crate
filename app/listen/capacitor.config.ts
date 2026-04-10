import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "org.lespedants.crate.listen",
  appName: "Crate Listen",
  webDir: "dist",

  server: {
    // In production, load from the deployed backend (same origin for cookies).
    // For local dev, override with your machine's IP + Vite dev port.
    url: process.env.CAPACITOR_SERVER_URL || "https://listen.lespedants.org",
    androidScheme: "https",
    iosScheme: "https",
    allowMixedContent: true,
    // Clear cookies/cache between sessions for clean state during development
    cleartext: true,
  },

  ios: {
    contentInset: "automatic",
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
      backgroundColor: "#0a0a0f",
    },
  },
};

export default config;
