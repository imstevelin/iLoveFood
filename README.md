# iLoveFood (友善食光地圖)

iLoveFood 是一個基於 Angular 構建的 Web 應用程式，旨在幫助使用者快速尋找附近的 7-11 與全家便利商店的「友善食光」及折扣商品。

## 🌟 核心功能

*   **📍 定位搜尋**: 允許使用設備 GPS 快速尋找附近有折扣商品的門市。
*   **🏪 門市/商品搜尋**: 支援輸入關鍵字、拼音等方式搜尋特定門市或商品。
*   **🛒 即時庫存顯示**: 整合 7-11 與全家便利商店的資料，顯示各門市的食物分類與剩餘數量。
*   **❤️ 收藏功能**: 整合 Firebase Authentication 與 Firestore，讓使用者可以登入並收藏常用門市。
*   **🤖 智能客服**: 內建聊天室功能，提供互動式的操作輔助。

## 🛠 技術堆疊

*   **前端框架**: Angular (搭配 TypeScript)
*   **樣式與 UI組件**: SCSS, Angular Material, Tailwind CSS
*   **後端與資料庫**: Firebase (Authentication, Firestore, Hosting)
*   **地圖與距離計算**: Geolib
*   **資料來源**: 本地靜態 JSON (`src/assets/`) 結合官方 API (跨域請求)

## 📂 專案結構簡介

*   `src/app/`: 應用程式核心邏輯與組件 (`search-food`, `chatbot`, `services` 等)。
*   `src/assets/`: 存放靜態資源，包含圖片以及 `seven_eleven_stores.json`, `family_mart_products.json` 等本地門市數據。
*   `src/environments/`: 開發與正式環境配置，包含 Firebase 金鑰與 API 端點。
*   `scripts/`: 包含一些測試 API 的 Node.js 腳本。
*   `crawer.py`: 根目錄下的 Python 爬蟲腳本，用於抓取或更新靜態資料。

## 🚀 開發指南

### 1. 安裝依賴
```bash
npm install
```

### 2. 啟動開發伺服器
```bash
npm start
```
或是使用 Angular CLI:
```bash
ng serve
```
然後在瀏覽器開啟 `http://localhost:4200/`。

### 3. 編譯正式版本
```bash
npm run build
```
或是:
```bash
ng build
```
編譯後的檔案會產生在 `dist/` 目錄中，即可部署至 Firebase Hosting 或其他伺服器。

## 📝 備註

*   **API 跨域限制**: 應用中調用了 7-11 等官方 API，可能需要處理 CORS 問題或確保在正確的網域下執行。
*   **資料更新**: 目前依賴 `src/assets/` 內的 JSON 檔案來提供門市與商品的基本對照表。這些資料可透過爬蟲定期更新。
