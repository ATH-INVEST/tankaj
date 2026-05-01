import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "si.tankaj.app",
  appName: "Tankaj",
  webDir: "out",
  server: {
    url: "http://localhost:3000",
    cleartext: true,
  },
  ios: {
    contentInset: "never",
    scrollEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: "#06140f",
      showSpinner: false,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#06140f",
      overlaysWebView: true,
    },
  },
};

export default config;