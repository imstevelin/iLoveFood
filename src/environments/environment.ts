// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

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
      mid_v: 'W0_DiF4DlgU5OeQoRswrRcaaNHMWOL7K3ra3381ocZUv-rdOWySZv4ctG6X-7pjiccl0C5h41-cHaupfvgcXKJKifEvNt9NiU94M_ZVp42Ig7JEn15la5iV0H3-8dZfASc7Mgke95qb9LYu3ghJ5Sam6D0LAnYK9Lb0DZg_YnSDhJwb-RrxfBT0X0fs'
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

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
