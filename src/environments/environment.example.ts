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
  // AI provider secrets must never be committed or embedded in an automated browser build.
  geminiApiKey: "",
  minimaxApiKey: "",
  umamiScript: ""
};
