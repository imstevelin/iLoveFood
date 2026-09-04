# 友善超人（iLoveFood）

友善超人是以 Angular 建構的開源研究性 Web 應用程式，協助使用者尋找全家與 7-Eleven 的即期折扣商品。正式網站為 [ilovefood.imstevelin.com](https://ilovefood.imstevelin.com)。

> **開源聲明**：本專案為開源專案，歡迎前往 GitHub 查看原始碼與參與貢獻！👉 [https://github.com/imstevelin/iLoveFood](https://github.com/imstevelin/iLoveFood)

---

## ✨ 核心亮點與功能 (Core Features)

### 🗺️ 1. Google Maps 順路門市搜尋 (Route Search)
使用者可貼上 Google Maps 路線分享連結（含短網址），並以汽車或 Google `TWO_WHEELER` 機車模式查詢沿路門市。機車路線目前為 Google Beta；系統最多處理 300 公里、40 個取樣點與 4 路並發，避免長路線壓垮即時庫存服務。

### 🔍 2. 智慧多選過濾與自定義搜尋 (Multi-Select Filtering)
整合自動完成 (Autocomplete) 與 Chips 標籤設計的搜索列：
- 支援多品項與分類選取，可同時尋找「無糖綠茶」與「便當」。
- 提供「自定義輸入」關鍵字，讓您跨平台精準比對。
- 具備防呆機制與長文字限縮處理，提供流暢的 UX 體驗。

### 🤖 3. AI Chatbot Beta
內建由 Google Gemini 或 Minimax 驅動的實驗性智能助理；此功能預設關閉，由使用者在「實驗室」中自行開啟：
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

*   **前端框架**: Angular 22 (TypeScript 6)
*   **樣式與組件**: Vanilla CSS, Tailwind CSS, Angular Material, SCSS 編譯
*   **後端與 API**: Cloudflare Workers
*   **資料庫與用戶驗證**: Firebase (Authentication, Firestore)
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

為了讓服務順利運行，專案需要依賴下列三個核心環境的配置：API 金鑰設定、Cloudflare Worker 全端服務以及 Linux 超商驗證農場。

### 🔑 1. API 金鑰與環境變數設定
專案中的 `src/environments/` 資料夾需建立正確的 `environment.ts` 與 `environment.prod.ts`，並參照 `environment.example.ts` 填寫下列金鑰。瀏覽器設定中不應包含 OPENPOINT `mid_v` 或 access token。
- **Firebase Config**: 用於手機簡訊 OTP 登入與 Firestore 收藏資料。Firebase Console 需啟用 Phone provider，並將正式網域加入 Authorized domains。
- **Gemini & Minimax API Keys**: 用於驅動「友善小精靈」 AI 聊天機器人的智能回覆。
- **Umami 追蹤碼**: 供網站流量追蹤（若無需求也可忽略）。

### ☁️ 2. Cloudflare Worker 全端部署
專案只使用一支 `ilovefood` Worker，同時提供 Angular SPA 靜態資源、Google Maps 短網址解析與 7-Eleven 庫存閘道：

```text
ilovefood.imstevelin.com       -> Angular SPA + /api/*
ilovefood-api.imstevelin.com   -> 舊版 API 網域相容路由
ilovefood-token-farm.imstevelin.com -> VPS Token Farm（Cloudflare Tunnel）
```

首次部署前先設定 Worker secret：

```bash
npx wrangler secret put TOKEN_FARM_API_KEY
```

正式部署前先建置並執行 Wrangler dry-run：

```bash
npm run deploy:check
```

建置 Angular 並部署整個網站：

```bash
npm run deploy
```

查看目前部署版本或串流正式環境日誌：

```bash
npm run deploy:status
npm run deploy:logs
```

專案根目錄的 `wrangler.jsonc` 是唯一部署設定來源，讓本機 Wrangler 與 Cloudflare Workers Builds 都能使用標準指令自動找到設定。它使用 Workers Static Assets 的 SPA fallback，並只讓 `/api/*` 與 `/health` 先進入 Worker 程式；其餘靜態檔案直接由 Cloudflare edge 傳送。正式環境的 `ALLOWED_ORIGINS` 必須保持為 `https://ilovefood.imstevelin.com`。`TOKEN_FARM_URL` 指向 VPS 的獨立 Tunnel，`API_RATE_LIMITER` 負責每 IP 限流。Worker 不會把 `mid_v` 或 OPENPOINT access token 回傳給瀏覽器。

#### 為什麼 Cloudflare 程式碼編輯器看不到 Angular 網站原始碼？

Worker 的程式碼編輯器只顯示執行中的 `cloudflare_worker/worker.js`。Angular 的 `src/app/**/*.ts`、HTML 與 SCSS 會先由 `npm run build` 編譯、壓縮並產生帶 hash 的 JavaScript/CSS/HTML 到 `dist/ilovefood/`，Wrangler 再依 `assets.directory` 將這些檔案以 Static Assets 集合上傳。它們和 Worker 屬於同一個部署與同一支 Worker，但不是 Worker script 的文字內容，因此不會出現在程式碼編輯器裡。

請把 Git 儲存庫與本機檔案視為原始碼的唯一來源，不要用 Cloudflare Quick Edit 修改前端。每次修改網站後執行 `npm run deploy`，就會先重新建置 Angular，再將 Worker 程式與有變更的靜態資產一起部署。

#### 可選：推送 Git 後自動部署

若要免除本機手動部署，可在 Cloudflare Dashboard 的 `ilovefood` Worker 進入 **Settings → Builds**，連接本專案的 GitHub 或 GitLab 儲存庫，並使用：

```text
Production branch: main
Root directory: /
Build command: npm run build
Deploy command: npx wrangler deploy
```

Worker 名稱必須與根目錄 `wrangler.jsonc` 的 `name` 同為 `ilovefood`。`npm run build` 會先執行 `scripts/prepare-environments.mjs`：本機既有且被忽略的環境檔不會被覆寫；Cloudflare 的乾淨 Git checkout 則會從安全範例建立環境檔。Firebase Web 設定可出現在瀏覽器，但 AI provider secret 不可提交，因此自動建置仍維持 Chatbot Beta 關閉。非正式分支可使用 `npx wrangler versions upload` 產生預覽版本，而不直接取代正式部署。

### 🚜 3. LINUX 超商驗證農場環境 (OPENPOINT Token Farm)
為確保自動且無縫地獲取 7-Eleven OPENPOINT 系統的動態加密保護 Token (`mid_v`)，我們設計了一套自動化農場：
- **原理**: 使用 Proxmox VE (PVE) 部署一台 Ubuntu Server，啟用 KVM 硬體加速執行 Android x86 模擬器，並透過 Frida Injection 與 Waitress API Server 打造零延遲伺服器。
- **教學**: 農場程式與部署文件已獨立至 [`openpoint-farmer`](./openpoint-farmer/)，詳細流程請參閱 [`DEPLOYMENT.md`](./openpoint-farmer/DEPLOYMENT.md)。Token Farm 預設只綁 `127.0.0.1`，`/get_token` 必須使用與 Worker 相同的 Bearer key；前端不可直接連線。

### 4. Firebase 規則與舊收藏遷移

```bash
firebase deploy --only firestore:rules
npm run migrate:favorites -- --all --project=PROJECT_ID
```

工具會依 Firebase Auth 的已驗證手機號碼自動找出對應 UID；也可改用 `--phone=0912345678 --uid=FIREBASE_UID` 遷移單一帳號。遷移預設保留舊手機號碼路徑；確認新 UID 收藏正確後，可加上 `--delete-source`。管理工具使用 Application Default Credentials，或傳入 `--service-account=/path/key.json`。

---

### 5. 前端開發伺服器啟動
配置完成後，即可啟動前端程式：
```bash
npm install
npm start
```
或是使用 Angular CLI: `ng serve`。然後在瀏覽器開啟 `http://localhost:4200/`。

### 6. 更新便利商店商品資料庫
若需要更新全家與 7-11 的最新商品清單（可配合排程操作）：
```bash
cd scripts
pip install -r ../requirements.txt
python update_products.py
```
此腳本將自動爬取最新商品並妥善併入 `src/assets/` 下的靜態 JSON 檔案中，確保每次搜尋都能找到官網剛發布的熱門鮮食。
