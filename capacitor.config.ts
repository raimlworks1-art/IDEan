import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.xyr.idean',
  appName: 'IDEan',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
};

export default config;
