# 友善超人（iLoveFood）

查詢全家與 7-Eleven 即期折扣商品的 Angular Web 應用程式。正式網站：<https://ilovefood.imstevelin.com>。

## 功能

- 依位置、門市、商品或分類搜尋庫存
- 由 Google Maps 分享連結搜尋沿途門市
- Worker 帳號登入與跨裝置收藏門市
- 可選用的 AI 助手實驗功能
- 深色模式與行動裝置介面

庫存、價格與優惠可能有延遲，請以門市現場資訊為準。

## 專案結構

```text
.
├── src/                    Angular 前端與靜態資料
├── worker/                 Cloudflare Worker API
├── migrations/             D1 資料庫版本
├── scripts/                資料更新與維護工具
└── wrangler.jsonc          網站與 Worker 的正式部署設定
```

建置輸出、相依套件、更新報告與本機私密設定都不納入版本控制。

## 本機開發

需求：Node.js 22.22.3 以上與 npm 10 以上。

```bash
npm install
cp src/environments/environment.example.ts src/environments/environment.ts
cp src/environments/environment.prod.example.ts src/environments/environment.prod.ts
npm start
```

開啟 <http://localhost:4200>。AI provider 與 OPENPOINT 個人識別資料不可提交。

首次以 Wrangler 啟動完整網站前，先建立本機 D1 結構：

```bash
npm run d1:migrate:local
```

常用檢查：

```bash
npm run check
npm test -- --watch=false --browsers=ChromeHeadless
npm run deploy:check
```

## Cloudflare 部署

`wrangler.jsonc` 會將 Angular 靜態資源與 `/api/*` Worker 一起部署。帳號、工作階段與收藏資料存放在 D1，密碼只保存 PBKDF2 雜湊。Worker 也會直接依照 7-ELEVEN App 的 AES-256-GCM 格式產生 `mid_v`，不再依賴 Android、Frida 或 Token Farmer。首次部署前將個人識別資料設為 Worker Secret：

```bash
npx wrangler secret put OPENPOINT_GID
npx wrangler secret put OPENPOINT_MID
npx wrangler secret put OPENPOINT_VCODE
npx wrangler secret put OPENPOINT_IMAP_MASTER_KEY
npm run d1:migrate:remote
npm run deploy:check
npm run deploy
```

本機執行 Wrangler 時可複製 `.dev.vars.example` 為 `.dev.vars` 後填入相同資料；該檔案已排除於版本控制。正式前端不會取得 `mid_v`、個人識別資料或 OPENPOINT access token。

本專案只使用由維護者設定的一組識別資料，不提供網站使用者輸入 OPEN POINT 帳號或密碼的功能。

其他維運指令：

```bash
npm run deploy:status
npm run deploy:logs
```

## 一次性取得 OPEN POINT 個人識別資料

依 7-ELEVEN App 5.73.0 驗證的流程為：

```text
官方登入頁 → seveneleven:// callback → code → access_token → MID → GID/VCode
```

登入換證使用 AES-256-CBC；產生 `mid_v` 使用不同的 iMAP 金鑰與 AES-256-GCM。callback 只能解出短效 code，三項識別資料仍須由 OPEN POINT 官方端點換取。它們目前長期穩定，但官方未保證永久有效。

先建立只存在本機且已被 Git 排除的設定檔：

```bash
cp openpoint-auth.env.example .env.openpoint
npm run openpoint:login-url
npm run openpoint:exchange -- 'seveneleven://711?return_code=00&v=...'
```

工具不接收 OPEN POINT 帳密，也不保存 code、token 或識別資料。請只在自己的帳號上操作，完整公式、安全注意事項與 callback 擷取方式見 [`OPENPOINT_AUTH.md`](./OPENPOINT_AUTH.md)。

## 資料與帳號維護

更新商品清單：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/update_products.py
```

套用 D1 資料庫版本：

```bash
npm run d1:migrate:local
npm run d1:migrate:remote
```

移除 Firebase 後，舊手機登入帳號無法轉換成密碼帳號；使用者需重新建立帳號與收藏。

原始碼位於 <https://github.com/imstevelin/iLoveFood>。
