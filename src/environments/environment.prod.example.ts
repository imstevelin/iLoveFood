export const environment = {
  production: true,
  familyMartUrl: {
    icon: 'assets/family-mart-logo.webp',
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
  // Chatbot Beta remains disabled in automated builds until its provider calls are moved behind the Worker.
  geminiApiKey: "",
  minimaxApiKey: "",
  umamiScript: ""
};
