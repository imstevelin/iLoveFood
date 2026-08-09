export const environment = {
  production: false,
  familyMartUrl: {
    icon: 'https://www.family.com.tw/ESG/images/icon/LOGO.ico',
    base: 'https://stamp.family.com.tw/api/maps',
    storeQuery: 'https://family.map.com.tw/famiport/api/dropdownlist/Select_StoreName',
    endpoint: {
      mapClassificationInfo: '/MapClassificationInfo',
      mapProductInfo: '/MapProductInfo'
    }
  },
  sevenElevenUrl: {
    icon: 'assets/7-11logo-320.webp',
  },
  firebaseConfig: {
    // Firebase Web API key is a public client identifier; restrict it to the production domains in Google Cloud.
    apiKey: "AIzaSyAsPcTvRVa51DW3und2SMu-ghLlCKIlD-Q",
    authDomain: "chat-9bfed.firebaseapp.com",
    projectId: "chat-9bfed",
    storageBucket: "chat-9bfed.firebasestorage.app",
    messagingSenderId: "7612717796",
    appId: "1:7612717796:web:9e231d7f1d97ebf4352af1"
  },
  // AI provider secrets must never be committed or embedded in an automated browser build.
  geminiApiKey: "",
  minimaxApiKey: "",
  umamiScript: ""
};
