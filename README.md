# 友善超人（iLoveFood）

查詢全家與 7-Eleven 即期折扣商品的 Angular Web 應用程式。正式網站：<https://ilovefood.imstevelin.com>。

## 功能

- 依位置、門市、商品或分類搜尋庫存
- 由 Google Maps 分享連結搜尋沿途門市
- Firebase 手機登入與收藏門市
- 可選用的 AI 助手實驗功能
- 深色模式與行動裝置介面

庫存、價格與優惠可能有延遲，請以門市現場資訊為準。

## 專案結構

```text
.
├── src/                    Angular 前端與靜態資料
├── worker/                 Cloudflare Worker API
├── openpoint-farmer/       OPENPOINT Token Farmer（位於專案根目錄）
├── scripts/                資料更新與維護工具
├── firestore.rules         Firestore 安全規則
└── wrangler.jsonc          網站與 Worker 的正式部署設定
```

建置輸出、相依套件、更新報告與 Farmer 私密資產都不納入版本控制。

## 本機開發

需求：Node.js 22.22.3 以上與 npm 10 以上。

```bash
npm install
cp src/environments/environment.example.ts src/environments/environment.ts
cp src/environments/environment.prod.example.ts src/environments/environment.prod.ts
npm start
```

開啟 <http://localhost:4200>。環境檔中的 Firebase Web 設定可提供給瀏覽器；AI provider、OPENPOINT Token 與 Farmer API key 不可提交。

常用檢查：

```bash
npm run check
npm test -- --watch=false --browsers=ChromeHeadless
npm run deploy:check
```

## Cloudflare 部署

`wrangler.jsonc` 會將 Angular 靜態資源與 `/api/*` Worker 一起部署。首次部署前設定 Farmer 共用金鑰：

```bash
npx wrangler secret put TOKEN_FARM_API_KEY
npm run deploy:check
npm run deploy
```

`ALLOWED_ORIGINS` 與 `TOKEN_FARM_URL` 位於 `wrangler.jsonc`。正式前端不會取得 `mid_v` 或 OPENPOINT access token。

其他維運指令：

```bash
npm run deploy:status
npm run deploy:logs
```

## OPENPOINT Farmer

Farmer 已集中在根目錄的 [`openpoint-farmer`](./openpoint-farmer/)；新部署推薦使用 Docker 映像：

```bash
cd openpoint-farmer/docker
./setup-linux-host.sh
cp .env.example .env
install -d -m 700 private
openssl rand -hex 32 > private/farmer_api_key.txt
sudo docker compose pull
sudo docker compose up -d
python3 verify-deployment.py --requests 500 --concurrency 32
```

Linux 主機必須支援 BinderFS。完整的 Docker、Proxmox LXC、離線映像與維運說明請見 [`openpoint-farmer/DEPLOYMENT.md`](./openpoint-farmer/DEPLOYMENT.md)。舊 AVD/systemd 部署方法與回滾指令仍保留在同一份文件的「既有主機快速升級」與「全新主機部署」章節，但不建議用於新環境。

## 資料與 Firebase 維護

更新商品清單：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/update_products.py
```

部署 Firestore 規則與遷移舊收藏：

```bash
firebase deploy --only firestore:rules
npm run migrate:favorites -- --all --project=PROJECT_ID
```

遷移工具預設保留來源資料；確認結果後才使用 `--delete-source`。

原始碼位於 <https://github.com/imstevelin/iLoveFood>。
