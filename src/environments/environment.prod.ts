export const environment = {
  production: true,
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
    icon: 'https://www.7-11.com.tw/favicon.ico',
    base: 'https://lovefood.openpoint.com.tw/LoveFood/api/',
    endpoint: {
      accessToken: 'Auth/FrontendAuth/AccessToken',
      getList: 'Master/FrontendItemCategory/GetList',
      getStoreByAddress: 'Master/FrontendStore/GetStoreByAddress',
      getNearbyStoreList: 'Search/FrontendStoreItemStock/GetNearbyStoreList',
      getStoreDetail: 'Search/FrontendStoreItemStock/GetStoreDetail'
    },
    params: {
      mid_v: 'W0_DiF4DlgU5OeQoRswrRcaaNHMWOL7K3ra3381ocZUv-rdOWy-ZuIItG6T-7pjiccl0C5h41-cHaupfvgcXKJKifEvNt9NiU94M_ZVp42Ig7JEn15la5iV0H3-8dZfASc7Mgke95qb9LYu3ghJ5Sam6D0LAnYK9Lb0DZohVkl1N5OTvWXvPb4VqEek'
    }
  },
  firebaseConfig: {
    apiKey: "AIzaSyAsPcTvRVa51DW3und2SMu-ghLlCKIlD-Q",
    authDomain: "chat-9bfed.firebaseapp.com",
    projectId: "chat-9bfed",
    storageBucket: "chat-9bfed.firebasestorage.app",
    messagingSenderId: "7612717796",
    appId: "1:7612717796:web:9e231d7f1d97ebf4352af1"
  }
};
