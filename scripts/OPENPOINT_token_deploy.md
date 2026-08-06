# 7‑ELEVEN `mid_v` Token 農場部署與維運指南

本指南說明如何在無圖形介面的 Linux 主機部署 7‑ELEVEN Token 農場，以及如何把已存在的舊版農場升級到 2026‑08‑06 的穩定版本。

正式程式碼已獨立存放在 [`scripts/op-farmer`](./op-farmer/)；文件不再複製另一份容易過期的程式碼。日後更新或重新部署時，直接安裝該目錄中的三個檔案即可：

- `hook_mid.js`：攔截 `mid_v`，並處理 App 強制更新 Activity。
- `reactive_farmer.py`：Token 池、ADB/Frida 自癒、HTTP API 與健康檢查。
- `start_farmer.sh`：單例監督、模擬器冷啟動、Frida 驗證與程序自動重建。

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
```

### 2. 安裝正式腳本

```bash
install -m 0644 scripts/op-farmer/reactive_farmer.py ~/op-farmer/reactive_farmer.py
install -m 0644 scripts/op-farmer/hook_mid.js ~/op-farmer/hook_mid.js
install -m 0755 scripts/op-farmer/start_farmer.sh ~/op-farmer/start_farmer.sh
```

若專案不在農場主機，先從本機傳送：

```bash
scp scripts/op-farmer/reactive_farmer.py user@server:~/op-farmer/
scp scripts/op-farmer/hook_mid.js user@server:~/op-farmer/
scp scripts/op-farmer/start_farmer.sh user@server:~/op-farmer/
ssh user@server 'chmod 755 ~/op-farmer/start_farmer.sh'
```

### 3. 部署前靜態檢查

在農場主機執行：

```bash
~/op-farmer/venv/bin/python -m py_compile ~/op-farmer/reactive_farmer.py
bash -n ~/op-farmer/start_farmer.sh
```

若主機有 Node.js，也可檢查 JavaScript 語法：

```bash
node --check ~/op-farmer/hook_mid.js
```

### 4. 停止舊程序並啟動新版

```bash
pkill -TERM -f "$HOME/op-farmer/start_farmer.sh" 2>/dev/null || true
pkill -TERM -f "$HOME/op-farmer/reactive_farmer.py" 2>/dev/null || true
sleep 3
nohup ~/op-farmer/start_farmer.sh >> ~/op-farmer/farmer_live.log 2>&1 </dev/null &
```

`start_farmer.sh` 會持有 `~/op-farmer/.farmer-supervisor.lock`。重複執行時，第二個監督程序會安全退出，不會同時啟動兩座模擬器。

### 5. 觀察冷啟動

```bash
tail -f ~/op-farmer/farmer_live.log
```

正常流程會依序出現：

```text
農場監督程序已啟動
Android 已完成開機
Frida Server 啟動成功
Frida 注入成功，系統就緒
啟動 Waitress 服務 (Port 5000, 8 threads)
預取成功
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
  flask flask-cors waitress \
  frida==16.2.1 frida-tools==12.3.0
```

依照「既有主機快速升級」第 2 步安裝三個正式腳本。

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

### 8. 設定開機啟動

以 `crontab -e` 加入一行：

```cron
@reboot sleep 30 && bash -c "cd $HOME/op-farmer && ./start_farmer.sh > $HOME/op-farmer/farmer_live.log 2>&1"
```

監督器會留在前台管理 worker；Cron 本身會讓它脫離登入工作階段。不要在 crontab 內再加第二層無限迴圈。

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
  "fetching": false,
  "last_error": null,
  "status": "ok",
  "token_age_seconds": 12.3,
  "token_ready": true
}
```

- HTTP 200：已有 Token 或正在補貨。
- HTTP 503：目前沒有 Token 且沒有成功補貨，檢查 `last_error` 與日誌。

### 取得 Token

```bash
curl -X POST http://127.0.0.1:5000/get_token
```

成功格式：

```json
{
  "status": "success",
  "mid_v": "..."
}
```

有庫存時會立即回傳；回傳後背景執行緒會立刻補貨。如果所有嘗試在 25 秒內都無法取得 Token，API 回傳 HTTP 503，讓呼叫端稍後重試。

### 對外服務

若使用 Cloudflare Tunnel 或其他 reverse proxy，將公開 hostname 指向 `http://127.0.0.1:5000`。不要直接把 ADB、模擬器 console 或 Frida Port 暴露到公網。

---

## 四、自癒層級

```text
HTTP request
    │
    ▼
TokenPool ──有庫存──▶ 立即回傳 ──▶ 立即補貨
    │
    └─無庫存──▶ 單一 fetch_token_job
                     │
                     ├─ADB timeout──▶ 重啟 ADB server/transport 後重試
                     ├─App/Frida 問題──▶ 重啟 App、Frida attach 與 hook
                     └─連續 3 次失敗──▶ exit 75
                                             │
                                             ▼
                                  start_farmer.sh supervisor
                                             │
                                             └─冷啟動模擬器與整套服務
```

重要特性：

- `emulator_lock` 保證同一時間只有一個執行緒操作 Android UI。
- `pool.condition` 直接喚醒 API 等待者，不再每 0.5 秒盲目輪詢。
- Frida 重新初始化前會 unload/detach 舊 client，避免反覆注入造成資源洩漏。
- Frida Server 用 `pidof asdf` 驗證，不會把 `grep` 自己誤認為 server。
- `wait-for-device` 後還會做真實 `adb shell` round trip，避免「顯示 device、實際已卡死」。
- 監督器使用檔案鎖防止重複實例；worker 崩潰、初始化失敗或主動 exit 75 都會恢復。

---

## 五、常用維運命令

### 查看程序與 Port

```bash
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

### API 回傳 503

先看 `/health` 的 `last_error`，再查 `farmer_live.log`。HTTP 503 代表服務有回應但正在恢復，與 Cloudflare 的 502（本機 Port 5000 完全沒有 listener）不同。

---

## 七、回滾

如果新版在不同 App 版本出現未預期行為：

```bash
pkill -TERM -f "$HOME/op-farmer/start_farmer.sh" 2>/dev/null || true
pkill -TERM -f "$HOME/op-farmer/reactive_farmer.py" 2>/dev/null || true
cp -a /path/to/backup/reactive_farmer.py ~/op-farmer/
cp -a /path/to/backup/hook_mid.js ~/op-farmer/
cp -a /path/to/backup/start_farmer.sh ~/op-farmer/
chmod 755 ~/op-farmer/start_farmer.sh
nohup ~/op-farmer/start_farmer.sh >> ~/op-farmer/farmer_live.log 2>&1 </dev/null &
```

回滾後仍應檢查 `/health` 與實際 `mid_v` 能否兌換 access token，而不只確認 Port 5000 有開啟。
