# iLoveFood (友善食光地圖 & 最新商品搜尋)

iLoveFood 是一個基於 Angular 構建的現代化 Web 應用程式。專為尋找全家與 7-Eleven 便利商店的「友善食光折扣商品」及「全網最新商品」而生。本作擁有獨特的「順路門市搜尋」功能、智能 AI 客服、以及極具質感的深色模式玻璃擬物 (Glassmorphism) 介面設計。

---

## ✨ 核心亮點與功能 (Core Features)

### 🗺️ 1. Google Maps 順路門市搜尋 (Route Search)
不再只是單純的「附近搜尋」，使用者可直接貼上 Google Maps 導航路線連結（支援短網址）。系統能在分析路線後，自動為您找出整條通勤或旅遊路線上的所有便利商店，成為通勤族的完美助手！

### 🔍 2. 智慧多選過濾與自定義搜尋 (Multi-Select Filtering)
整合自動完成 (Autocomplete) 與 Chips 標籤設計的搜索列：
- 支援多品項與分類選取，可同時尋找「無糖綠茶」與「便當」。
- 提供「自定義輸入」關鍵字，讓您跨平台精準比對。
- 具備防呆機制與長文字限縮處理，提供流暢的 UX 體驗。

### 🤖 3. AI 智能客服 (Gemini Powered Chatbot)
內建由 Google Gemini 2.5 Flash 驅動的智能助理：
- 具備防 ban 機制的記憶體緩衝與分頁設計。
- 專為行動裝置優化的聊天滾動體驗。
- 支援上下文理解，幫您解答商品內容、推薦吃法甚至是熱量估算。

### 🎨 4. 頂級現代美學介面 (Premium UI/UX)
- 完美支援全站 **Dark Mode (深色模式)** 與動態模式切換。
- 大量採用 **Glassmorphism (玻璃擬物風)**，使背景、對話框與搜尋列具有高級的毛玻璃穿透感。
- 豐富的 Micro-animations (微動畫) 與 Skeleton Loading (骨架屏)，操作流暢不卡頓。

### 🕷️ 5. 強大的雙引擎爬蟲資料庫 (Robust Data Engine)
資料庫內含超過 30,000 筆商品資訊：
- **`scripts/update_products.py`**: 採用 Python 撰寫的全自動雙引擎爬蟲。
- 結合了官方 XML Data API 以及利用 `BeautifulSoup` 針對最新行銷網頁（如全家最夯鮮食）進行深度解析的混合抓取技術。
- 「只增不減」的安全合併策略，絕不漏抓任何最新上架的商品。

### ☁️ 6. 現代化雲端代理 (Cloudflare Worker Proxy)
放棄傳統後端，全面改用 Cloudflare Worker (`cloudflare_worker/worker.js`) 作為邊緣運算 API Proxy：
- 完美解決跨網域 (CORS) 限制。
- 安全隱藏 Google Maps API, Gemini API 等重要金鑰。

---

## 🛠 技術堆疊 (Tech Stack)

*   **前端框架**: Angular 18 (TypeScript)
*   **樣式與組件**: Vanilla CSS, Tailwind CSS, Angular Material, SCSS 編譯
*   **後端與 API**: Cloudflare Workers
*   **資料庫與用戶驗證**: Firebase (Authentication, Firestore, Hosting)
*   **地圖與定位**: Google Maps Directions API, Geolib
*   **數據更新引擎**: Python 3 (Requests, BeautifulSoup4)

---

## 📂 專案結構簡介 (Project Structure)

```text
iLoveFood/
├── src/
│   ├── app/             # Angular 應用程式核心邏輯與組件
│   ├── assets/          # 靜態資源 (包含逾 3 萬筆的商品對照 JSON)
│   └── environments/    # 開發與正式環境配置 (Firebase 金鑰與端點)
├── cloudflare_worker/   # Cloudflare Worker 後端代理程式碼
├── scripts/             # Python 爬蟲與自動化更新腳本
│   └── update_products.py
├── tailwind.config.js   # Tailwind CSS 樣式配置
└── angular.json         # Angular 建置配置
```

---

## 🚀 開發與部署指南 (Getting Started)

### 1. 安裝依賴
```bash
npm install
```

### 2. 啟動開發伺服器
```bash
npm start
```
或是使用 Angular CLI: `ng serve`。然後在瀏覽器開啟 `http://localhost:4200/`。

### 3. 編譯正式版本
```bash
npm run build
```
編譯後的檔案會產生在 `dist/friendly-time/` 目錄中。

### 4. 更新商品資料庫
若需要抓取全家與 7-11 的最新商品清單：
```bash
cd scripts
pip install -r ../requirements.txt
python update_products.py
```
此腳本將自動爬取最新商品並妥善併入 `src/assets/` 下的靜態 JSON 檔案中。

---
