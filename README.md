# iLoveFood (友善食光地圖 & 最新商品搜尋)

iLoveFood 是一個基於 Angular 構建的現代化 Web 應用程式。專為尋找全家與 7-Eleven 便利商店的「友善食光折扣商品」及「全網最新商品」而生。本作擁有獨特的「順路門市搜尋」功能、智能 AI 客服、以及極具質感的深色模式玻璃擬物 (Glassmorphism) 介面設計。

> **開源聲明**：本專案為開源專案，歡迎前往 GitHub 查看原始碼與參與貢獻！👉 [https://github.com/imstevelin/iLoveFood](https://github.com/imstevelin/iLoveFood)

---

## ✨ 核心亮點與功能 (Core Features)

### 🗺️ 1. Google Maps 順路門市搜尋 (Route Search)
不再只是單純的「附近搜尋」，使用者可直接貼上 Google Maps 導航路線連結（支援短網址）。系統能在分析路線後，自動為您找出整條通勤或旅遊路線上的所有便利商店，成為通勤族的完美助手！

### 🔍 2. 智慧多選過濾與自定義搜尋 (Multi-Select Filtering)
整合自動完成 (Autocomplete) 與 Chips 標籤設計的搜索列：
- 支援多品項與分類選取，可同時尋找「無糖綠茶」與「便當」。
- 提供「自定義輸入」關鍵字，讓您跨平台精準比對。
- 具備防呆機制與長文字限縮處理，提供流暢的 UX 體驗。

### 🤖 3. AI 智能客服 (Gemini & Minimax Powered Chatbot)
內建由 Google Gemini 2.5 Flash 或 Minimax 驅動的智能助理：
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
│   └── environments/    # 開發與正式環境配置 (須設定相關金鑰)
├── cloudflare_worker/   # Cloudflare Worker 後端代理程式碼
├── scripts/             # Python 爬蟲、自動化更新腳本與驗證農場部署指南
├── tailwind.config.js   # Tailwind CSS 樣式配置
└── angular.json         # Angular 建置配置
```

---

## 🚀 環境配置與開發指南 (Getting Started)

為了讓服務順利運行，專案需要依賴下列三個核心環境的配置：API 金鑰設定、Cloudflare Worker 代理以及 Linux 超商驗證農場。

### 🔑 1. API 金鑰與環境變數設定
專案中的 `src/environments/` 資料夾需建立正確的 `environment.ts` 與 `environment.prod.ts`，並參照 `environment.example.ts` 填寫下列金鑰：
- **Firebase Config**: 用於資料庫同步、用戶登入與收藏店家資料儲存。
- **Gemini & Minimax API Keys**: 用於驅動「友善小精靈」 AI 聊天機器人的智能回覆。
- **Umami 追蹤碼**: 供網站流量追蹤（若無需求也可忽略）。

### ☁️ 2. Cloudflare Worker 代理配置
由於需要規避瀏覽器的 CORS 限制並隱身發送外部網路請求，本專案全面改用 Cloudflare Workers 作為邊緣運算 API 代理：
- 請進入 `cloudflare_worker/` 目錄中，將 `worker.js` 部署至您的 Cloudflare 帳戶。
- 該 Worker 專門攔截並處理 Google Maps 導航短網址的解碼轉換，並偽裝瀏覽器避免被阻擋，將轉址後的最終結果安全回傳給前端。

### 🚜 3. LINUX 超商驗證農場環境 (OPENPOINT Token Farm)
為確保自動且無縫地獲取 7-Eleven OPENPOINT 系統的動態加密保護 Token (`mid_v`)，我們設計了一套自動化農場：
- **原理**: 使用 Proxmox VE (PVE) 部署一台 Ubuntu Server，啟用 KVM 硬體加速執行 Android x86 模擬器，並透過 Frida Injection 與 Waitress API Server 打造零延遲伺服器。
- **教學**: 詳細部署流程請務必參閱 `scripts/OPENPOINT_token_deploy.md`。透過遠端連線安裝 APK 並駐留記憶體，本系統將能達成毫秒級回應與高併發處理，讓前端在請求最新庫存時能夠被動式地取得超商驗證 token。

---

### 4. 前端開發伺服器啟動
配置完成後，即可啟動前端程式：
```bash
npm install
npm start
```
或是使用 Angular CLI: `ng serve`。然後在瀏覽器開啟 `http://localhost:4200/`。

### 5. 更新便利商店商品資料庫
若需要更新全家與 7-11 的最新商品清單（可配合排程操作）：
```bash
cd scripts
pip install -r ../requirements.txt
python update_products.py
```
此腳本將自動爬取最新商品並妥善併入 `src/assets/` 下的靜態 JSON 檔案中，確保每次搜尋都能找到官網剛發布的熱門鮮食。
