import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "si.tankaj.app",
  appName: "Tankaj",
  webDir: "out",
  server: {
  url: "https://www.tankaj.si/?app=1",
  cleartext: false,
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
    overlaysWebView: false,
  },
},
};

export default config;
