import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.darklock.securechannel',
  appName: 'RIDGELINE',
  webDir: 'dist',
  server: {
    // In development, point to your local Vite dev server
    // url: 'http://192.168.50.X:1421',
    // cleartext: true,
    androidScheme: 'https',
    iosScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0a0a0f',
      showSpinner: false,
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0a0a0f',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    backgroundColor: '#0a0a0f',
  },
  android: {
    backgroundColor: '#0a0a0f',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
