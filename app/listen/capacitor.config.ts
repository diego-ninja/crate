import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "org.lespedants.crate.listen",
  appName: "Crate Listen",
  webDir: "dist",

  server: {
    // Load app from local bundle (fast, works offline).
    // API calls go to api.lespedants.org via VITE_API_URL baked at build time.
    androidScheme: "https",
    iosScheme: "https",
    allowMixedContent: true,
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
