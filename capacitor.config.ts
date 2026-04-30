import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "si.tankaj.app",
  appName: "Tankaj",
  server: {
    url: "https://www.tankaj.si",
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#071f13",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#071f13",
      overlaysWebView: true,
    },
  },
};

export default config;