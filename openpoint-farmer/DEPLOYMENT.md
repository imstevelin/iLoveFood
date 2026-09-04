# 7‑ELEVEN `mid_v` Token 農場部署與維運指南

本指南說明如何在無圖形介面的 Linux 主機部署 7‑ELEVEN Token 農場。新部署建議使用 2026‑09‑04 的 Docker 版；後半部仍保留舊 AVD/systemd 架構的升級與回滾說明。

農場程式碼、Docker 檔與本指南現在都集中於 [`openpoint-farmer`](./) 目錄；文件不再複製另一份容易過期的程式碼。舊 AVD/systemd 架構使用以下四個核心檔案：

- `hook_mid.js`：攔截 `mid_v`，並處理 App 強制更新 Activity。
- `reactive_farmer.py`：可重複使用的 Token 快取、App 休眠、ADB/Frida 自癒、資源看門與 HTTP API。
- `start_farmer.sh`：單例監督、模擬器冷啟動、Frida 驗證與程序自動重建。
- `op-farmer.service`：systemd 系統服務，在開機、supervisor 崩潰或被 OOM 中止後重建農場。

## 2026‑09‑04 Docker 可攜部署（建議方式）

農場現已封裝為單一容器，映像同時包含 Android 12 reDroid、OPENPOINT App、Frida 16.2.1、Python API 與自癒監督器。不再需要手動安裝 Android SDK、建立 AVD、配對 Frida Server 或保留特定 PVE VM；只要目標是支援 BinderFS 的 Linux Docker 主機即可部署。

封裝檔位於 [`docker`](./docker/)：

- `Dockerfile`：同時建置 `linux/amd64` 與 `linux/arm64`，並針對目標架構放入正確的 Frida Server。
- `compose.yaml`：預設最多 1 vCPU、1.25GiB RAM、自動重啟、持久化 Android `/data`、Docker secret 與健康檢查。
- `setup-linux-host.sh`：在新 Linux 主機啟用 `binder_linux` 與 BinderFS。
- `build-multiarch.sh`：產生離線 OCI 封存檔或直接發布多架構映像。
- `export-bootstrap-state.py`：從已正常運作的 App 中只擷取啟動所需的 6 個匿名狀態欄位，不把整份 SharedPreferences 放入映像。

### Docker 主機要求

- 正式運行：x86_64 或 ARM64 Linux，核心需啟用 `CONFIG_ANDROID_BINDER_IPC` 與 `CONFIG_ANDROID_BINDERFS`。
- 建議使用完整 Linux VM 或實體主機。在 Proxmox LXC 內運行 Docker 時，Binder 核心模組必須由 PVE 宿主機載入並將裝置傳入 LXC；LXC 內的 `root` 也無法取代宿主機完成這一步。
- 建議主機至少提供 2 vCPU、1.25GiB 可用 RAM，並為 Docker 與 Linux 保留額外空間。容器預設只允許使用最多 1 vCPU；這是上限而非預留量，Token 就緒並休眠後只會使用實際需要的 CPU。特別慢的巢狀虛擬化主機可將 `FARMER_CPUS=2.0`。
- 1GiB 在實測冷啟動時曾達約 993MiB，幾乎觸頂，不適合長期使用。
- macOS 的 Docker Desktop 可建置映像，但其 Linux VM 不預設提供農場需要的 Binder 環境，不列為運行平台。x86_64 Linux 是目前完整運行驗收平台。

新 Linux 主機先安裝 Docker Engine，然後執行：

```bash
cd openpoint-farmer/docker
./setup-linux-host.sh
```

若腳本回報 `binder_linux was already loaded without Android devices`，重開機一次後重跑。若回報核心未提供 BinderFS，需改用已啟用上述 kernel config 的主機，這無法在一般容器內補上。

### Proxmox LXC 特別處理

可先在目標 Linux 環境執行 `systemd-detect-virt`。如果結果是 `lxc`，`uname` 顯示的是 PVE 宿主機核心，但 LXC 內不會擁有該核心的 `/lib/modules`。此時不要在 LXC 內安裝另一個 Linux kernel，因為 LXC 不會開機使用它。

最穩定的處理是改用完整 Linux VM。若必須使用 LXC，需由 PVE 管理者在「PVE 實體宿主機」完成：

1. 確認當前 PVE kernel 有 `binder_linux` 與 BinderFS，並載入 `binder_linux devices=binder,hwbinder,vndbinder`。
2. 確認宿主機上的 `/dev/binder`、`/dev/hwbinder`、`/dev/vndbinder` 都是 character device。
3. 停止該 LXC，在 `/etc/pve/lxc/<CTID>.conf` 允許 Binder device major，並將三個裝置 bind mount 到 LXC 的同名路徑。LXC 還需啟用 Docker nesting；實際的 device major 必須在 PVE 宿主機上由 `stat` 取得，不可猜測。
4. 重新啟動 LXC，確認三個 `/dev/*binder` 裝置可見後，才在 LXC 內重跑 `setup-linux-host.sh`。

參考的 LXC 裝置傳入項目如下；`<BINDER_MAJOR>` 必須以 PVE 宿主機上 `stat -c '%t' /dev/binder` 的十六進位結果轉為十進位：

```text
features: nesting=1,keyctl=1
lxc.cgroup2.devices.allow: c <BINDER_MAJOR>:* rwm
lxc.mount.entry: /dev/binder dev/binder none bind,create=file
lxc.mount.entry: /dev/hwbinder dev/hwbinder none bind,create=file
lxc.mount.entry: /dev/vndbinder dev/vndbinder none bind,create=file
```

如果在 PVE 宿主機上執行 `modprobe binder_linux` 仍顯示模組不存在，代表該 PVE kernel 本身不符合條件；需由 PVE 管理者換用包含這些功能的核心，或直接將負載改部署在完整 VM。

### 建置資產與發布邊界

下列原始檔案已被 `.gitignore` 排除，不會提交到 Git：

```text
openpoint-farmer/docker/private/openpoint.apk
openpoint-farmer/docker/private/bootstrap-prefs.xml
openpoint-farmer/docker/private/farmer_api_key.txt
```

`openpoint.apk` 與經篩選的 `bootstrap-prefs.xml` 依擁有者明確要求烘焙在發布映像內，使新主機無需舊 VM 即可啟動。`farmer_api_key.txt` 僅是每個部署的 API 存取金鑰，永遠不會複製到映像。

`bootstrap-prefs.xml` 並不是 Token，而是讓新 Android `/data` 能以原有匿名 OPENPOINT 身分啟動的最小狀態。如需從另一座已正常運作的模擬器重新產生：

```bash
adb root
adb pull /data/data/ecowork.seven/shared_prefs/ecowork.seven_preferences.xml /tmp/openpoint-preferences.xml
python3 openpoint-farmer/docker/export-bootstrap-state.py /tmp/openpoint-preferences.xml
rm -f /tmp/openpoint-preferences.xml
chmod 600 openpoint-farmer/docker/private/bootstrap-prefs.xml
```

啟動時不會直接覆寫 App 正在使用的 SharedPreferences；Frida hook 會在記憶體層提供這些啟動值，避免 App/Firebase 背景 writer 把檔案覆蓋而造成偶發登入跳轉。

API key 以 Docker secret 檔案提供：

```bash
cd openpoint-farmer/docker
install -d -m 700 private
umask 077
read -rsp 'Farmer API key: ' FARMER_API_KEY
printf '%s\n' "$FARMER_API_KEY" > private/farmer_api_key.txt
unset FARMER_API_KEY
```

### 啟動、健康檢查與關閉

```bash
cd openpoint-farmer/docker
cp .env.example .env
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
sudo docker compose logs -f farmer
```

等待服務健康後，可執行不會顯示 API key 或 Token 的整合與負載驗證：

```bash
python3 verify-deployment.py --requests 500 --concurrency 32
```

正式環境預設不逐筆記錄成功的快取查詢，也不記錄 Waitress 的瞬時佇列警告，
避免高流量時持久 volume 產生大量無診斷價值的 I/O。需要短期除錯時，可在
`.env` 設定 `FARMER_LOG_API_REQUESTS=1` 或
`FARMER_LOG_QUEUE_WARNINGS=1`；HTTP worker 數可用 `FARMER_HTTP_THREADS`
調整，預設為 16。

若主機只安裝 Docker Engine、沒有 `docker compose` 外掛，可以使用附帶的等價腳本；它會套用同一份 `.env`、secret、資源限制、持久 volume 與 `unless-stopped` 自動重啟策略：

```bash
./run-standalone.sh
```

若映像已由 `docker load` 離線載入，可設定 `FARMER_SKIP_PULL=1`，腳本會先確認
本機確實存在 `.env` 指定的映像，再跳過 Registry 拉取：

```bash
FARMER_SKIP_PULL=1 ./run-standalone.sh
```

完全全新的 `/data` volume 約需 45‑120 秒安裝 App、啟動 Android 並產生第一枚 Token。正常後：

```bash
curl -fsS http://127.0.0.1:5000/health
api_key="$(sed -n '1p' private/farmer_api_key.txt)"
curl -fsS -X POST http://127.0.0.1:5000/get_token \
  -H "Authorization: Bearer ${api_key}"
unset api_key
```

停止但保留 Android 狀態：

```bash
sudo docker compose down
```

連 `/data` volume 一併重置為全新農場：

```bash
sudo docker compose down --volumes
```

最後一個指令會刪除容器內的 Android 持久狀態，只有在確定要冷啟動重建時才使用。

### 查看 Android 實體畫面

ADB 預設只綁定在主機 `127.0.0.1:5555`。在主機本機執行：

```bash
adb connect 127.0.0.1:5555
scrcpy -s 127.0.0.1:5555
```

從其他電腦觀看時，先建立 SSH tunnel，不要將 5555 公開到網際網路：

```bash
ssh -L 5555:127.0.0.1:5555 user@docker-host
adb connect 127.0.0.1:5555
scrcpy -s 127.0.0.1:5555
```

### 多架構映像與搬遷

本機產生同時含 x86_64 與 ARM64 的 OCI 封存檔：

```bash
cd openpoint-farmer/docker
./build-multiarch.sh --oci
shasum -a 256 dist/op-farmer-multiarch.oci.tar
```

目前已驗證的封存檔索引同時包含 `linux/amd64` 與 `linux/arm64`。正式映像發布於 [Docker Hub](https://hub.docker.com/r/imstevelin/ilovefood-openpoint-farmer)，Docker 會依目標主機自動拉取正確架構；`2026.09.4` 是可重現的固定版本，`latest` 指向目前穩定版：

```bash
FARMER_IMAGE=imstevelin/ilovefood-openpoint-farmer:2026.09.4 \
  ./build-multiarch.sh --push
```

如需離線將 OCI 封存匯入 x86_64 Docker Engine，可在目標 Linux 主機安裝 `skopeo` 後執行：

```bash
skopeo copy --override-arch amd64 \
  oci-archive:op-farmer-multiarch.oci.tar \
  docker-daemon:imstevelin/ilovefood-openpoint-farmer:2026.09.4
```

映像內依擁有者授權包含受驗證的 APK 與假名化啟動狀態，所以公開映像能在全新 volume 中直接建立農場。運行時的 Android 狀態在 `ilovefood-op-farmer-data` volume；搬遷後不復原 volume 也可由內建 bootstrap 自動建立全新環境。Farmer API key 不在映像中，每台主機仍應自行產生。

### Docker 版實測結果

2026‑09‑04 在全新 Ubuntu 26.04.1、2 vCPU、3.3GiB RAM 的無圖形 KVM
測試機 B，從零安裝 Docker 29.1.3 與 Compose 2.40.3，執行
`setup-linux-host.sh` 後以全新 `/data` volume 驗收本次原始碼映像：

- 1 vCPU / 1.25GiB 限額下，最慢一次從建立容器到可查詢 Token 為 81 秒；首次 Token 兌換驗證成功，0 重啟、0 OOM。
- 1,000 次、32 路併發查詢全數成功，p50 20.81ms、p95 31.13ms、最大 47.58ms。
- 5,000 次、64 路併發查詢全數成功，p50 40.83ms、p95 51.37ms、最大 145.85ms；高流量測試沒有產生逐筆 Token 或 Waitress queue 日誌。
- App 休眠後有效記憶體約 748‑788MiB，閒置 CPU 約 0.2‑0.4%；冷啟動取樣峰值約 795MiB。`/health` 另直接回報 cgroup memory 與 PID 用量／上限。
- 刻意 `SIGSTOP` Frida Server 後，watchdog 觸發軟重啟，啟動器清除失去回應的 PID 1819、建立新 PID 3960，約 85 秒內自行恢復 healthy，無需重建 Docker 容器。
- 映像內容大小由 785,900,729 bytes 降至 778,912,568 bytes（減少 6,988,161 bytes，約 0.89%）。Dockerfile 明確固定 init／啟動腳本權限，避免 Linux umask 造成 Android init 忽略服務。

同日將完全相同的映像（ID
`sha256:ba50ccfc840f67e05d6532f0c8f26df3917bc89d06643d43bb984c92590f8961`）
離線載入並修復正式主機 A，沿用既有 API key 與 `/data` volume：

- 容器在切換後 11.06 秒內可查詢，首次擷取與兌換驗證成功，0 重啟、0 OOM。
- 1,000 次、32 路併發全數成功，p95 28.39ms、最大 42.56ms。
- 5,000 次、64 路併發全數成功，p95 50.86ms、最大 90.85ms。
- 休眠後取樣為 CPU 0.49%、有效記憶體 653MiB；cgroup memory 768.7MiB、PID 921/2048。
- API 與 ADB 仍只綁定 `127.0.0.1`，API key 以唯讀 bind mount 提供；舊映像保留為 `ilovefood/op-farmer:rollback-20260904`。

2026-09-04 的公開倉庫驗收：從 Docker Hub 匿名拉取 `2026.09` 成功，執行的 RepoDigest 與發布索引 `sha256:bcf45710a9d0705033bdcec83880c33924a9606fa761f6dca25df5c02e1aeecd` 一致。公開映像在 x86_64 Linux 的全新 volume 約 40 秒進入 healthy，首次內部 Token 兑換驗證成功，0 重啟、0 OOM；冷啟動後連續 20 次 API 查詢全數成功，p50 0.90ms、p95 1.17ms、最大 1.23ms。

2026‑09‑04 在 x86_64 Linux Docker Engine 上以全新 volume 實測：

- 從容器啟動到第一枚可兌換 `mid_v` 約 46 秒。
- 連續 4 個背景更新週期成功，0 次擷取失敗、0 次兌換驗證失敗、0 次 OOM，容器無重啟。
- 單次 App 擷取約 0.23‑0.43 秒，Token 實際兌換驗證約 0.11‑0.40 秒。
- 20 路併發、100 次 API 查詢全數成功；p50 13.44ms、p95 437.70ms、最大 447.52ms，全部低於 1.5 秒。
- 1 vCPU / 1.25GiB 限制下尖峰記憶體約 1.15GiB，安全通過冷啟動與週期更新。

雙農場測試使用相同映像與 bootstrap、兩個獨立 Android volume，同時以正式 180/240 秒更新設定運作約 8 分鐘。第二座初始擷取加兩次背景換發為 3/3 成功，第一座在期間也持續換發，兩邊驗證失敗都為 0。A→B→A→B 交錯兑換全部 HTTP 200；兩邊同時各 100 次 API 查詢共 200/200 成功，p95 約 384‑387ms、最大約 401ms，容器無重啟與 OOM。這表示目前的假名化識別狀態可同時供多座農場使用，不會因其中一邊換發就撤銷另一邊。

與舊 AVD 版相比，Docker 版額外修正了三個會讓「容器看似正常、Token 實際不可用」的問題：Android 預設 UTC 導致加密時間差 8 小時、首頁固定座標輕觸誤開外部 WebView、以及 SharedPreferences 與 Firebase writer 的競爭。新版固定 `Asia/Taipei`、移除危險觸控並在每次啟動前清掉外部 WebView，同時改用記憶體層 bootstrap。

## 2026‑08‑09 Frida teardown 死鎖修復

2026‑08‑08 23:01:17 農場已成功擷取並發布 Token，23:01:18 進入 App 休眠；但之後 App PID 仍存在，且不再出現更新日誌。Token 於 240 秒後過期，API 從 23:57 起持續逾時。當時 `/health` 顯示 `fetching=true`、`pool_size=0`，造成程序與 Port 都活著、實際服務卻永久失效的假活狀態。

根因不是 Android 畫面或網路：GDB 顯示 token worker 已在 `_frida.abi3.so` 的條件等待中卡住超過 4000 秒。舊版在寫入新 Token 後同步呼叫 `Script.unload()` 與 `Session.detach()`，其中一個原生 teardown RPC 永不返回，因此後續 Android `force-stop`、`is_fetching=false` 與下一次更新都無法執行。

2026‑08‑09 版做了兩層修正：

- 休眠順序改為先由 Android `am force-stop` 終止目標程序；目標死亡會一併銷毀 injected agent。Python 只丟棄舊 client reference，不再於更新關鍵路徑同步呼叫 Frida unload/detach。
- 每個更新工作記錄 `fetch_started_at` 與 `fetch_stage`。任何階段超過 45 秒仍未結束，獨立 maintainer 會以 exit 75 要求 supervisor 完整重建，原生函式即使再度卡住也不可能永久假活。
- `/health` 新增 `fetch_stage`、`fetch_age_seconds` 與 `fetch_timeout_seconds`，可直接判斷工作正在排程、初始化、擷取或休眠。
- 實機修復後第一枚 `mid_v` 對外取得耗時 243.77ms，同一值連續兌換兩次 access token 均為 HTTP 200、`isSuccess=true`。

目前仍固定 Frida client/server 16.2.1。Frida 17 已不再於 GumJS 內建 Java bridge，不能只替換 client/server 而沿用現有 `hook_mid.js`；若要升級，必須先用 `frida-java-bridge` 編譯 bundle 並另做完整回歸，不要在正式主機直接原地升級。

## 2026‑08‑07 長時間穩定化摘要

6 小時穩定性測試共發送 720 次對外請求，720 次全部成功，可用性 100%；對外平均 68.24ms、p95 128.59ms、最大 267.71ms。但該測試也暴露了未反映在 HTTP 延遲上的長期劣化：

1. 每次來回切換 i地圖與首頁，舊 App 會持續累積 WebView。測試結束時已有 20 個 WebView、44 個 socket，App PSS 約 374MiB，其中原生堆約 276MiB。
2. 預取平均時間由第一小時約 5.05 秒退化至第六小時約 8.19 秒。
3. QEMU RSS 在 6 小時內增加約 1.05GiB，軟體 GPU 即使閒置仍佔用約 190% CPU。
4. 原有 `flock` fd 會被 ADB 繼承；即使 supervisor 已退出，殘留 ADB 仍可能永久占住單例鎖。
5. `@reboot` 只負責開機時啟動一次，supervisor 本身退出後不會復活。

2026‑08‑07 版的處理方式：

- `mid_v` 在過期前可重複使用，因此預設只保留 1 枚快取。所有短時間併發請求都直接回傳同一枚，不會每次查詢就啟動 App 另取新值。
- 只在快取更新時啟動 App 與 Frida attach；新值就緒後先 `am force-stop`，再丟棄已隨目標程序失效的 Frida client，使 App 大多數時間維持休眠，每一次更新都從乾淨的 WebView 進程開始。
- Token 在 180 秒時就背景滾動更新，240 秒後絕不對外回傳；新 Token 成功擷取前，舊快取仍可繼續服務，成功後再原子替換。
- API 最多等待 15 秒，失敗就明確回傳 HTTP 503 與 `Retry-After: 2`，不讓使用者無限等待。
- 連續 3 次擷取失敗時完整冷啟動；主機可用記憶體或 QEMU RSS 連續越界時也會主動重建。
- worker 啟動前關閉繼承的鎖 fd，單例鎖只由外層 supervisor 持有。
- 改由 systemd 系統服務管理，並明確加入 `kvm` supplementary group；不再依賴已登入的圖形階段或單次 Cron。

實機回歸中，App 休眠後閒置 CPU 由約 190% 降至多數 3–10%，QEMU swap 由約 900MiB 降為 0。休眠策略原型繼續運行約 94 分鐘，60 次預取無失敗，p95 2.12 秒、systemd 無重啟、閒置 CPU 五次取樣平均 2.4%。確認 `mid_v` 可重複使用後，正式版再將預取頻率降為每約 180 秒一次。

可重用快取版的實機驗證結果：20 路同時呼叫對外 API 全部 HTTP 200，20 份回應的 `mid_v` 完全相同，平均 503.18ms、p95 954.01ms、最大 1093.97ms；同一枚 `mid_v` 連續兌換兩次 access token 也都成功。另以每 2 秒一筆請求跨越 180 秒更新點，29/29 全部 HTTP 200、p95 1.26ms、最大 27.92ms；更新期間持續回傳舊值，擷取成功後雜湊只切換一次，證實背景更新不會阻塞前景查詢。

## 2026‑08‑06 修復摘要

這次故障並非單一逾時，而是下列問題串連造成：

1. 7‑ELEVEN App 啟動後顯示「應用程式已更新快來下載！」。它是完整的 `MessageLightboxActivity`，舊版只攔截 `Dialog`，因此 App 每次自癒重啟後都無法進入 i地圖。
2. 啟動腳本把 SDK 的 `platform-tools` 放在 PATH 後方，實際使用到系統 `/usr/bin/adb`，與 SDK 內新版 ADB 混用。模擬器長時間運行後，`wait-for-device` 可能仍回報在線，但 `adb shell` 已經卡死。
3. Frida 驗證遇到一次暫時性 ADB 問題就退出，而外層沒有常駐監督程序，最後只剩模擬器空跑，Port 5000 永久離線。
4. Token 被取用後，要等背景輪詢最多 5 秒才開始補貨；API 端另以 0.5 秒輪詢等待，造成查詢時間不固定。
5. 舊 hook 將包含完整 `mid_v` 的 WebView URL 寫入日誌，不必要地暴露憑證並讓日誌持續膨脹。

新版處理方式：

- 精準辨識並關閉強制更新 Activity，攔截後續重複導航，再主動進入 `MainActivity`。
- 固定使用 `$ANDROID_HOME/platform-tools/adb` 與 `emulator-5554`，ADB 指令逾時先重建 transport 再重試。
- 使用 `flock` 單例監督程序；Python 以 exit code 75 要求完整冷啟動，任何非預期退出也會在 5 秒後重建。
- Android 開機、Frida Server 和 ADB 指令都有明確逾時；不再永久卡在啟動流程。
- Token 池改用 `threading.Condition` 通知等待者；Token 消耗後立即補貨，背景檢查縮短為 1 秒。
- 新增 `GET /health`，回報庫存、補貨狀態、Token 年齡、連續失敗與最後錯誤。
- Waitress 增加到 8 threads；不再記錄完整 WebView URL 或 Token。
- 模擬器固定以 2GB RAM、1 vCPU 啟動；重啟時等待 qemu socket/lock 釋放，降低假性開機失敗。

## 已驗證環境與結果

2026‑08‑06 在下列環境完成實機驗證：

- Ubuntu/Linux 主機：5.8GiB RAM、2GiB swap、KVM 可用。
- Android Emulator 36.6.11、API 30 Google APIs x86_64。
- ADB 37.0.0（SDK `platform-tools`）。
- Frida client/server 16.2.1。
- 7‑ELEVEN package：`ecowork.seven`。
- 模擬器畫面：320×640、160 dpi。

驗證項目：

- 完整冷啟動成功，Frida 注入後第一枚 Token 約 5 秒產生。
- 以 6 秒間隔連續查詢 5 次，全部 HTTP 200；對外回應時間為 0.176–0.525 秒。
- 取得的 `mid_v` 能成功呼叫 7‑ELEVEN `Auth/FrontendAuth/AccessToken`，`isSuccess=true` 且回傳 access token。
- 刻意終止 Python 核心程序後，監督程序偵測 exit 143、自動重建模擬器、Frida 與 API，恢復後健康檢查為 HTTP 200。

這些是部署當下的回歸測試結果，不代表外部 App 或 API 日後永遠不變；新版監督與健康檢查的目的，就是在外部狀態變動時可自動恢復並留下明確診斷資訊。

---

## 一、既有主機快速升級

以下命令在包含本專案的電腦或主機執行。假設專案根目錄為目前工作目錄，農場位於 `~/op-farmer`。

### 1. 備份線上版本

```bash
backup_dir="$HOME/op-farmer/backups/$(date '+%Y%m%d-%H%M%S')"
mkdir -p "$backup_dir"
cp -a ~/op-farmer/reactive_farmer.py "$backup_dir/"
cp -a ~/op-farmer/start_farmer.sh "$backup_dir/"
cp -a ~/op-farmer/hook_mid.js "$backup_dir/"
cp -a ~/op-farmer/farmer_live.log "$backup_dir/" 2>/dev/null || true
cp -a ~/op-farmer/emulator.log "$backup_dir/" 2>/dev/null || true
sudo cp -a /etc/systemd/system/op-farmer.service "$backup_dir/" 2>/dev/null || true
crontab -l > "$backup_dir/crontab.txt" 2>/dev/null || true
```

### 2. 安裝正式腳本

```bash
install -m 0644 openpoint-farmer/reactive_farmer.py ~/op-farmer/reactive_farmer.py
install -m 0644 openpoint-farmer/hook_mid.js ~/op-farmer/hook_mid.js
install -m 0755 openpoint-farmer/start_farmer.sh ~/op-farmer/start_farmer.sh
sudo install -m 0644 openpoint-farmer/op-farmer.service /etc/systemd/system/op-farmer.service
```

若專案不在農場主機，先從本機傳送：

```bash
scp openpoint-farmer/reactive_farmer.py user@server:~/op-farmer/
scp openpoint-farmer/hook_mid.js user@server:~/op-farmer/
scp openpoint-farmer/start_farmer.sh user@server:~/op-farmer/
scp openpoint-farmer/op-farmer.service user@server:~/op-farmer/
ssh user@server 'chmod 755 ~/op-farmer/start_farmer.sh'
```

`op-farmer.service` 內的 `User`、`Group`、`HOME`、`XDG_RUNTIME_DIR` 與絕對路徑預設為目前正式主機的 `imstevelin`/UID 1000。若部署到其他帳號，必須先同步修改這些欄位，再安裝到 `/etc/systemd/system`。

### 3. 部署前靜態檢查

在農場主機執行：

```bash
~/op-farmer/venv/bin/python -m py_compile ~/op-farmer/reactive_farmer.py
bash -n ~/op-farmer/start_farmer.sh
sudo systemd-analyze verify /etc/systemd/system/op-farmer.service
```

若主機有 Node.js，也可檢查 JavaScript 語法：

```bash
node --check ~/op-farmer/hook_mid.js
```

### 4. 切換為 systemd 並啟動新版

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now op-farmer.service
sudo systemctl restart op-farmer.service
sudo systemctl --no-pager --full status op-farmer.service
```

`start_farmer.sh` 會持有 `~/op-farmer/.farmer-supervisor.lock`。重複執行時，第二個監督程序會安全退出，不會同時啟動兩座模擬器。若舊版曾使用 Cron，確認 systemd 正常後移除舊 `@reboot ... start_farmer.sh` 條目，避免兩套啟動管理並存。

### 5. 觀察冷啟動

```bash
tail -f ~/op-farmer/farmer_live.log
```

正常流程會依序出現：

```text
農場監督程序已啟動
Android 已完成開機
Frida Server 啟動成功
Frida 注入成功，補貨引擎就緒
啟動 Waitress 服務 (Port 5000, 8 threads, pool=1)
預取成功，擷取 ...；快取 1/1
Token 快取已就緒，休眠 App 以釋放 WebView / CPU 資源
```

完整冷啟動通常需要 1–2 分鐘。首次 Token 完成前，`/health` 可能短暫顯示 `fetching=true`。

---

## 二、全新主機部署

### 1. 系統需求

- Ubuntu 22.04/24.04 或相容 Linux，支援 KVM。
- 建議至少 6GB RAM；模擬器固定配置 2GB。
- Java 17。
- 可從另一台電腦透過 SSH tunnel 與 scrcpy 操作首次登入。

### 2. 安裝基礎套件

```bash
sudo apt update
sudo apt install -y \
  openjdk-17-jdk qemu-kvm cpu-checker psmisc util-linux \
  python3-pip python3-venv wget unzip xz-utils openssh-server
sudo usermod -aG kvm "$USER"
```

執行 `kvm-ok` 應顯示 KVM 可用。加入群組後需重新登入。

### 3. 安裝 Android SDK

```bash
mkdir -p ~/android_sdk/cmdline-tools
cd ~/android_sdk/cmdline-tools
wget https://dl.google.com/android/repository/commandlinetools-linux-10406996_latest.zip
unzip commandlinetools-linux-10406996_latest.zip
mv cmdline-tools latest
rm commandlinetools-linux-10406996_latest.zip

export ANDROID_HOME="$HOME/android_sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

yes | sdkmanager \
  "system-images;android-30;google_apis;x86_64" \
  "platform-tools" \
  "emulator"
echo no | avdmanager create avd \
  -n token_farmer \
  -k "system-images;android-30;google_apis;x86_64" \
  --force
```

把上述三個 `export` 加入 `~/.bashrc`。SDK `platform-tools` 必須放在 PATH 前方，避免誤用系統舊版 ADB。

### 4. 固定 AVD 尺寸

UI 自動化座標依賴 320×640；新建 AVD 後確認 `~/.android/avd/token_farmer.avd/config.ini` 包含：

```ini
hw.cpu.ncore = 1
hw.lcd.density = 160
hw.lcd.height = 640
hw.lcd.width = 320
hw.ramSize = 2048M
vm.heapSize = 512M
```

若欄位已存在，請修改原值，不要重複追加多份設定。啟動腳本也會以 `-memory 2048 -cores 1` 明確覆蓋資源設定。

### 5. 建立 Python 環境

```bash
mkdir -p ~/op-farmer
python3 -m venv ~/op-farmer/venv
~/op-farmer/venv/bin/pip install \
  flask waitress \
  frida==16.2.1 frida-tools==12.3.0
```

依照「既有主機快速升級」第 2 步安裝四個正式檔案。

### 6. 安裝並登入 7‑ELEVEN App

先以 Headless 模式啟動：

```bash
nohup "$ANDROID_HOME/emulator/emulator" \
  -avd token_farmer \
  -no-window -no-audio -gpu swiftshader_indirect \
  -memory 2048 -cores 1 -no-snapshot-load \
  > ~/op-farmer/emulator_init.log 2>&1 &

"$ANDROID_HOME/platform-tools/adb" wait-for-device
until [ "$("$ANDROID_HOME/platform-tools/adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  sleep 3
done
```

從本地電腦建立 SSH tunnel：

```bash
ssh -L 5555:127.0.0.1:5555 user@server
adb connect 127.0.0.1:5555
scrcpy -s 127.0.0.1:5555
```

安裝 7‑ELEVEN APK、完成登入與簡訊驗證，確認能看到 App 首頁。Package 必須是 `ecowork.seven`。

### 7. 安裝 Frida Server

Frida client/server 版本必須一致：

```bash
cd /tmp
wget https://github.com/frida/frida/releases/download/16.2.1/frida-server-16.2.1-android-x86_64.xz
unxz frida-server-16.2.1-android-x86_64.xz
mv frida-server-16.2.1-android-x86_64 asdf

ADB="$HOME/android_sdk/platform-tools/adb"
"$ADB" root
"$ADB" wait-for-device
"$ADB" push /tmp/asdf /data/local/tmp/asdf
"$ADB" shell chmod 755 /data/local/tmp/asdf
"$ADB" shell /data/local/tmp/asdf --version
```

最後一行應輸出 `16.2.1`。

### 8. 設定開機啟動與崩潰復原

使用 systemd 系統服務，而不是只會在開機時執行一次的 Cron：

```bash
sudo install -m 0644 ~/op-farmer/op-farmer.service /etc/systemd/system/op-farmer.service
sudo systemctl daemon-reload
sudo systemctl enable --now op-farmer.service
sudo systemctl --no-pager --full status op-farmer.service
```

服務必須以實際農場帳號運行，並保留 `SupplementaryGroups=kvm`。如果省略該 group，即使 SSH 登入後的 `id` 看得到 `kvm`，早已啟動的 user manager 仍可能因為群組快取而無法開啟 `/dev/kvm`。

---

## 三、API 與健康檢查

### 健康檢查

```bash
curl -i http://127.0.0.1:5000/health
```

Token 已就緒時：

```json
{
  "consecutive_failures": 0,
  "fetch_age_seconds": null,
  "fetch_stage": "idle",
  "fetch_timeout_seconds": 45,
  "fetching": false,
  "app_state": "hibernating",
  "last_error": null,
  "pool_capacity": 1,
  "pool_size": 1,
  "status": "ok",
  "token_age_seconds": 12.3,
  "token_ready": true
}
```

- HTTP 200：至少有一枚未過期 Token 可立即回傳。`app_state=hibernating` 是正常的省資源狀態。
- HTTP 503：目前沒有可用 Token；即使 `fetching=true` 也不會把「正在嘗試」誤報成已就緒。檢查 `last_error`、`app_state` 與日誌。

### 取得 Token

```bash
curl -X POST http://127.0.0.1:5000/get_token \
  -H "Authorization: Bearer ${FARMER_API_KEY}"
```

成功格式：

```json
{
  "status": "success",
  "mid_v": "..."
}
```

有快取時會立即回傳，並不會移除該 Token；併發請求可重複取得同一值。只有快取接近過期時才在背景更新。如果 15 秒內仍無法取得任何有效 Token，API 回傳 HTTP 503 與 `Retry-After: 2`。

`FARMER_API_KEY` 為必填，請產生至少 32 bytes 的隨機值並存入 `/etc/ilovefood/op-farmer.env`（權限 `0600`）；Worker 的 `TOKEN_FARM_API_KEY` secret 必須使用相同值。服務預設只監聽 `127.0.0.1`，如有特殊網路拓撲才透過 `FARMER_BIND_HOST` 調整。

其他可調環境變數通常不需更改：`FARMER_TOKEN_REFRESH_SECONDS=180`、`FARMER_TOKEN_TTL_SECONDS=240`、Docker 版 `FARMER_FETCH_JOB_TIMEOUT_SECONDS=120`、`FARMER_API_WAIT_TIMEOUT_SECONDS=15`、`FARMER_MIN_HOST_AVAILABLE_MIB=128`、`FARMER_HTTP_THREADS=16`。`FARMER_LOG_API_REQUESTS` 與 `FARMER_LOG_QUEUE_WARNINGS` 預設皆為 `0`。快取容量固定為 1，因為增加容量只會多做無必要的 App 查詢。

### 對外服務

若使用 Cloudflare Tunnel 或其他 reverse proxy，將只有 Worker 知道的私有 hostname 指向 `http://127.0.0.1:5000`，並保留 Bearer 驗證。不要把 Token Farm、ADB、模擬器 console 或 Frida Port 直接暴露到公網。

---

## 四、自癒層級

```text
HTTP request
    │
    ▼
TokenCache(1) ──有效──▶ 併發請求重複回傳同一 Token
    │
    └─180s 滾動更新或無快取──▶ 單一 fetch_token_job
                     │
                     ├─開始更新──▶ 啟動 App/Frida 擷取一枚新 Token
                     ├─原子替換──▶ force-stop App + 丟棄失效 Frida client
                     ├─ADB timeout──▶ 重啟 ADB server/transport 後重試
                     ├─App/Frida 問題──▶ 重啟 App、Frida attach 與 hook
                     ├─任一階段超過設定上限──▶ exit 75
                     └─連續 3 次失敗──▶ exit 75
                                             │
                                             ▼
                                  start_farmer.sh supervisor
                                             │
                                             └─冷啟動模擬器與整套服務
                                                    │
                                                    └─supervisor 退出─▶ systemd 重建
```

重要特性：

- `emulator_lock` 保證同一時間只有一個執行緒操作 Android UI。
- `pool.condition` 直接喚醒 API 等待者，不再每 0.5 秒盲目輪詢。
- Android `force-stop` 會終止 agent；Python 不在 refresh thread 同步 unload/detach，避免原生 teardown 死鎖。
- fetch watchdog 獨立於 token worker；Docker 版預設 120 秒，舊 AVD 版預設 45 秒。即使 worker 卡在釋放 GIL 的原生函式，maintainer 仍能要求完整重建。
- 快取已就緒後 App 進程不存在是預期行為；可避免 WebView、socket 與軟體 GPU 長時間累積。
- Frida Server 用 `pidof asdf` 驗證，不會把 `grep` 自己誤認為 server。
- `wait-for-device` 後還會做真實 `adb shell` round trip，避免「顯示 device、實際已卡死」。
- 監督器使用檔案鎖防止重複實例，worker 不會把鎖 fd 傳給 ADB/QEMU；worker 崩潰、初始化失敗或主動 exit 75 都會恢復。
- systemd 在最外層提供第二道復原，並確保 KVM 群組與開機自動啟動。

---

## 五、常用維運命令

### 查看程序與 Port

```bash
sudo systemctl --no-pager --full status op-farmer.service
pgrep -a -f 'start_farmer|reactive_farmer|qemu-system|asdf'
ss -ltnp | grep -E ':5000|:5037|:12345|:5554|:5555'
```

正常主機應只有一個 supervisor、一個 Python worker 與一個 `token_farmer` qemu。

### 查看日誌

```bash
tail -f ~/op-farmer/farmer_live.log
tail -f ~/op-farmer/emulator.log
```

新版 hook 不會記錄完整 URL 或 `mid_v`。請把舊版含 Token 的日誌視為敏感資料，限制權限並定期清理或封存。

### 查看目前 Activity

```bash
ADB="$HOME/android_sdk/platform-tools/adb"
"$ADB" shell dumpsys activity activities | grep mResumedActivity
"$ADB" shell uiautomator dump /sdcard/window.xml
"$ADB" shell cat /sdcard/window.xml
```

強制更新頁的 Activity 為：

```text
ecowork.seven/.activity.lightbox.MessageLightboxActivity
```

它可能設定 `FLAG_SECURE`，導致 `screencap` 產生 0 byte；此時使用 `uiautomator dump`、`dumpsys activity` 或 SSH tunnel + scrcpy 判讀，不要把空截圖誤判為整個模擬器圖形系統壞掉。

### 手動要求完整重建

正常情況不需要手動殺程序。若要做故障演練，可終止 worker；supervisor 會自動重建：

```bash
pkill -TERM -f "$HOME/op-farmer/reactive_farmer.py"
tail -f ~/op-farmer/farmer_live.log
```

預期看到 `農場程序結束`、重新執行 `[1/4]` 至 `[4/4]`，最後再次 `預取成功`。

若要由最外層重建，使用：

```bash
sudo systemctl restart op-farmer.service
sudo journalctl -u op-farmer.service -n 50 --no-pager
```

---

## 六、疑難排解

### 卡在 SplashActivity

確認新版 `hook_mid.js` 已安裝。它會攔截 `MessageLightboxActivity`，而 Python 在 hook 生效後會主動啟動：

```text
ecowork.seven/.activity.MainActivity
```

若仍卡住，檢查 Frida hook 錯誤與目前 Activity，不要只增加固定 sleep。

### ADB 時好時壞

確認實際 binary：

```bash
readlink -f /proc/$(pgrep -o adb)/exe
~/android_sdk/platform-tools/adb version
```

農場應使用 SDK ADB，而不是 `/usr/bin/adb`。若手動診斷，可執行：

```bash
~/android_sdk/platform-tools/adb kill-server
~/android_sdk/platform-tools/adb start-server
~/android_sdk/platform-tools/adb -s emulator-5554 wait-for-device
~/android_sdk/platform-tools/adb -s emulator-5554 shell echo OK
```

### Frida Server 啟動失敗

```bash
ADB="$HOME/android_sdk/platform-tools/adb"
"$ADB" shell ls -lh /data/local/tmp/asdf
"$ADB" shell /data/local/tmp/asdf --version
"$ADB" shell pidof asdf
"$ADB" shell cat /data/local/tmp/frida-server.log
```

binary 必須是 x86_64、可執行、非空檔，且版本需與 Python client 相同。

### 模擬器開機後立即退出

```bash
tail -n 200 ~/op-farmer/emulator.log
kvm-ok
free -h
df -h ~
```

監督器會自動重試。若每次都退出，檢查 KVM 權限、磁碟空間、AVD lock 與 Port 5554/5555 是否被其他模擬器占用。

由 systemd 啟動時，不只檢查 SSH shell 的 `id`，也要檢查實際服務程序：

```bash
pid="$(systemctl show -p MainPID --value op-farmer.service)"
grep '^Groups:' "/proc/$pid/status"
```

輸出必須包含主機的 `kvm` GID。正式 unit 已透過 `SupplementaryGroups=kvm` 明確設定。

### API 回傳 503

先看 `/health` 的 `last_error`，再查 `farmer_live.log`。HTTP 503 代表服務有回應但正在恢復，與 Cloudflare 的 502（本機 Port 5000 完全沒有 listener）不同。

---

## 七、回滾

如果新版在不同 App 版本出現未預期行為：

```bash
sudo systemctl stop op-farmer.service
cp -a /path/to/backup/reactive_farmer.py ~/op-farmer/
cp -a /path/to/backup/hook_mid.js ~/op-farmer/
cp -a /path/to/backup/start_farmer.sh ~/op-farmer/
chmod 755 ~/op-farmer/start_farmer.sh
sudo cp -a /path/to/backup/op-farmer.service /etc/systemd/system/op-farmer.service
sudo systemctl daemon-reload
sudo systemctl start op-farmer.service
```

回滾後仍應檢查 `/health` 與實際 `mid_v` 能否兌換 access token，而不只確認 Port 5000 有開啟。
