# 🚀 7-ELEVEN Token 自動化農場部署指南

本指南將引導您從零開始，在無圖形介面 (Headless) 的 Linux 伺服器上部署 7-ELEVEN Token (`mid_v`) 自動化抓取系統。
此版本特別針對 **4GB RAM 伺服器** 進行了極致優化，解決了 App 閃退、虛擬機掉線、系統彈窗阻撓及連續抓取失敗等痛點。

> **更新紀錄 (2026-06-15)**：本文件已根據實際部署經驗全面修訂。主要變更包括：
> - App 由 OpenPoint 改為 **7-ELEVEN** (`ecowork.seven`)，i地圖位於底部選單**第二項**
> - Java 版本由 11 升級至 **17** (最新 Android SDK cmdline-tools 不相容 Java 11)
> - 新增 `platform-tools` 與 `emulator` 的顯式安裝步驟
> - 新增 `ANDROID_SDK_ROOT` 環境變數設定 (模擬器啟動必需)
> - 首次啟動模擬器改為 `-no-window` Headless 模式，搭配 SSH 隧道 + scrcpy 進行遠端操作
> - 強化 Frida Server 推送後的完整性驗證步驟
> - 更新所有 UI 操作座標以符合 7-ELEVEN App 的實際 UI 佈局

---

## 系統需求
*   **宿主機**: Ubuntu 20.04 / 22.04 / 24.04 或 Linux Mint (支援 KVM 虛擬化)
*   **硬體資源**: 至少 4GB RAM (建議保留 1.5GB ~ 2.5GB 給模擬器使用)
*   **本地環境**: 需準備一台有圖形介面的電腦 (Windows/Mac/Linux) 用於首次遠端畫面投射與人工登入。本地需安裝 `adb` 與 `scrcpy`。

---

## 一、 伺服器環境安裝

### 1. 確保 SSH 服務已啟用
如果您的伺服器尚未啟用 SSH，請先在伺服器上執行：
```bash
sudo apt update
sudo apt install openssh-server -y
sudo systemctl enable --now ssh
```

### 2. 安裝基礎套件與 Android SDK
在您的伺服器上執行以下指令：
```bash
sudo apt update
# 【重要】必須使用 Java 17，Java 11 不相容最新的 Android SDK cmdline-tools
sudo apt install -y openjdk-17-jdk bridge-utils cpu-checker libvirt-clients libvirt-daemon-system qemu-kvm virt-manager adb nmap python3-pip python3-venv psmisc wget unzip scrcpy

# 下載並配置 Android SDK
mkdir -p ~/android_sdk/cmdline-tools
cd ~/android_sdk/cmdline-tools
wget https://dl.google.com/android/repository/commandlinetools-linux-10406996_latest.zip
unzip commandlinetools-linux-*_latest.zip
mv cmdline-tools latest
rm commandlinetools-linux-*_latest.zip

# 設定環境變數 (請將以下內容加入至 ~/.bashrc，並執行 source ~/.bashrc)
export ANDROID_HOME=$HOME/android_sdk
export ANDROID_SDK_ROOT=$HOME/android_sdk    # 模擬器啟動時會驗證此變數
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
```

### 3. 建立並優化虛擬機 (AVD)
```bash
# 下載系統映像檔、platform-tools 與 emulator (強烈建議使用 API 30)
# 【重要】必須顯式安裝 platform-tools 與 emulator，否則模擬器會因找不到 SDK 路徑而啟動失敗
yes | sdkmanager "system-images;android-30;google_apis;x86_64" "platform-tools" "emulator"

# 建立 AVD
echo "no" | avdmanager create avd -n token_farmer -k "system-images;android-30;google_apis;x86_64" --force

# 【關鍵步驟】優化硬體配置，解決 App 閃退問題
sed -i 's/hw.ramSize =.*/hw.ramSize = 2560M/' ~/.android/avd/token_farmer.avd/config.ini
sed -i 's/vm.heapSize =.*/vm.heapSize = 512M/' ~/.android/avd/token_farmer.avd/config.ini
echo "hw.cpu.ncore = 2" >> ~/.android/avd/token_farmer.avd/config.ini
echo "hw.lcd.density = 120" >> ~/.android/avd/token_farmer.avd/config.ini
```

### 4. 配置 Python 虛擬環境
```bash
mkdir -p ~/op-farmer && cd ~/op-farmer
python3 -m venv venv
source venv/bin/activate
# 指定 Frida 版本以確保穩定性
pip install flask flask-cors waitress frida==16.2.1 frida-tools==12.3.0
```

---

## 二、 遠端畫面投射與人工登入 (首次環境建置)

為了讓農場腳本能夠運作，您必須先**手動安裝 7-ELEVEN APP 並完成登入**。

### 1. 在伺服器端啟動模擬器
在伺服器上以 Headless 模式啟動模擬器 (使用 `-no-window` 避免 Qt 平台外掛錯誤)：
```bash
# 啟動模擬器 (Headless 模式)
nohup emulator -avd token_farmer -no-window -no-audio -gpu swiftshader_indirect -writable-system -memory 2560 -no-snapshot-load > emulator_init.log 2>&1 &

# 等待模擬器開機 (約 1-2 分鐘)
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" == "1" ]; do sleep 3; echo "still booting..."; done
echo "Emulator is ready!"
```

### 2. 從本地端連線並登入
請回到您的**本地電腦 (Windows/Mac/Linux)** 上進行操作：

1.  **建立 SSH 隧道**: 將伺服器的模擬器 port (5555) 轉發到本地。打開本地終端機輸入：
    ```bash
    # 將 user 替換為您的伺服器帳號，server_ip 替換為伺服器 IP
    ssh -L 5555:127.0.0.1:5555 user@server_ip
    ```
2.  **連接模擬器**: 保持 SSH 隧道開啟，開啟另一個本地終端機輸入：
    ```bash
    # 讓本地 ADB 連接伺服器上的模擬器
    adb connect 127.0.0.1:5555
    # 確認連線成功 (應顯示 127.0.0.1:5555 device)
    adb devices
    ```
3.  **投射畫面**: 在本地終端機啟動 scrcpy 觀看並操作模擬器畫面：
    ```bash
    scrcpy -s 127.0.0.1:5555
    ```
    > **Mac 安裝提示**：若 `adb` 或 `scrcpy` 尚未安裝，可執行 `brew install android-platform-tools scrcpy`

### 3. 安裝 APP 與登入
現在您應該能在本地看到伺服器模擬器的畫面了。
1.  下載 7-ELEVEN APP 的 APK 檔案到您的本地電腦。
2.  透過 ADB 安裝：
    ```bash
    adb -s 127.0.0.1:5555 install /path/to/7eleven.apk
    ```
3.  **人工登入**:
    *   在 scrcpy 畫面中打開 7-ELEVEN APP。
    *   手動完成帳號、密碼與簡訊驗證等登入流程。
    *   確認登入成功後，請停留在 App 首頁。

完成登入後，請關閉本地的 scrcpy 視窗，並在**伺服器**上關閉剛才啟動的模擬器，準備進入全自動化部署階段：
```bash
# 在伺服器上執行
pkill -9 emulator
pkill -9 qemu-system
```

### 4. 準備 Frida Server (asdf)
將 `frida-server` 推送到模擬器中 (本指南使用 `16.2.1` 版)：
```bash
cd /tmp
wget https://github.com/frida/frida/releases/download/16.2.1/frida-server-16.2.1-android-x86_64.xz
unxz frida-server-16.2.1-android-x86_64.xz
mv frida-server-16.2.1-android-x86_64 asdf

# 重啟模擬器推送檔案
nohup emulator -avd token_farmer -no-window -no-audio -gpu swiftshader_indirect -writable-system -memory 2560 -no-snapshot-load > /dev/null 2>&1 &

echo "Waiting for emulator to boot..."
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]; do sleep 3; done
sleep 5

adb root && adb wait-for-device
adb push asdf /data/local/tmp/
adb shell "chmod 755 /data/local/tmp/asdf"

# 【重要】驗證 Frida Server 是否能正常執行
# 若顯示版本號 (如 16.2.1) 即表示正常；若出現 Segmentation fault 代表檔案損壞，需重新下載
adb shell "/data/local/tmp/asdf --version"

adb emu kill
```

---

## 三、 部署核心腳本

請在伺服器的 `~/op-farmer` 目錄下建立以下三個檔案：

### 1. `hook_mid.js`
此腳本負責攔截 Token 並自動屏蔽干擾 UI 的系統彈窗。
```bash
cat << 'EOF' > ~/op-farmer/hook_mid.js
// ~/op-farmer/hook_mid.js
Java.perform(function () {
    var WebView = Java.use('android.webkit.WebView');
    WebView.loadUrl.overload('java.lang.String').implementation = function (url) {
        if (url.indexOf("mid_v=") !== -1) {
            var midMatch = url.match(/mid_v=([^&]+)/);
            if (midMatch && midMatch[1]) {
                send({ "type": "token_captured", "mid_v": midMatch[1] });
            }
        }
        return this.loadUrl(url);
    };

    var CookieManager = Java.use('android.webkit.CookieManager');
    CookieManager.setCookie.overload('java.lang.String', 'java.lang.String').implementation = function (url, value) {
        if (value.indexOf("mid_v") !== -1) {
            var midMatch = value.match(/mid_v=([^;&]+)/);
            if (midMatch && midMatch[1]) {
                send({ "type": "token_captured", "mid_v": midMatch[1] });
            }
        }
        return this.setCookie(url, value);
    };

    // 強力屏蔽：更新提示與退出確認彈窗
    var Dialog = Java.use('android.app.Dialog');
    var AlertDialog = Java.use('android.app.AlertDialog');
    
    Dialog.show.implementation = function () {
        var className = this.getClass().getName();
        if (className.match(/Update|Version|Upgrade|Exit|Quit/i)) {
            console.log("[*] 偵測到干擾彈窗 (" + className + ")，已自動屏蔽。");
            return;
        }
        return this.show();
    };

    AlertDialog.show.implementation = function () {
        var className = this.getClass().getName();
        if (className.match(/Update|Version|Upgrade|Exit|Quit/i)) {
            console.log("[*] 偵測到干擾 AlertDialog (" + className + ")，已自動屏蔽。");
            return;
        }
        return this.show();
    };
});
EOF
```

### 2. `reactive_farmer.py`
重構後的 Python 服務，採用「五步智慧 UI 操作鏈」，已針對 7-ELEVEN App 調整座標。
```bash
cat << 'EOF' > ~/op-farmer/reactive_farmer.py
# ~/op-farmer/reactive_farmer.py
import frida, time, subprocess, threading
from flask import Flask, jsonify, request
from flask_cors import CORS
from waitress import serve

app = Flask(__name__)
CORS(app)

# 7-ELEVEN App 穩定版座標設定 (MDPI 120-160 適用)
# 座標基於 uiautomator dump 分析，螢幕解析度 320x640
SAFE_BLANK_X, SAFE_BLANK_Y = 10, 50     # 點擊空白處關廣告
HOME_TAB_X, HOME_TAB_Y = 32, 607        # 底部首頁選單 (第一個標籤，bounds [0,575][64,640])
I_MAP_X, I_MAP_Y = 96, 607              # 底部 i地圖按鈕 (第二個標籤，bounds [64,575][128,640])
APP_NAME = "7-ELEVEN"
PKG_NAME = "ecowork.seven"

captured_data = {"token": None, "updated_at": 0}
emulator_lock = threading.Lock()

class TokenPool:
    def __init__(self):
        self.token = None
        self.updated_at = 0
        self.is_fetching = False
        self.lock = threading.Lock()

pool = TokenPool()

def on_message(message, data):
    if message['type'] == 'send':
        payload = message['payload']
        if payload.get('type') == 'token_captured':
            captured_data["token"] = payload['mid_v'].replace('\n', '')
            captured_data["updated_at"] = time.time()

def adb_run(cmd):
    return subprocess.run(["adb", "shell"] + cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def open_app_and_prepare():
    print(f"[*] 啟動 {APP_NAME}...")
    subprocess.run(["adb", "shell", "monkey", "-p", PKG_NAME, "-c", "android.intent.category.LAUNCHER", "1"], stdout=subprocess.DEVNULL)
    time.sleep(10)

    print("[*] 關閉可能存在的廣告彈窗...")
    adb_run(["input", "tap", str(SAFE_BLANK_X), str(SAFE_BLANK_Y)])
    time.sleep(2)

    print("[*] 切換至首頁選單待命...")
    adb_run(["input", "tap", str(HOME_TAB_X), str(HOME_TAB_Y)])
    time.sleep(3)

def init_frida():
    try:
        print("\n====================================")
        subprocess.run(["adb", "wait-for-device"])
        subprocess.run(["adb", "forward", "tcp:12345", "tcp:12345"])
        
        open_app_and_prepare()
        device = frida.get_device_manager().add_remote_device("127.0.0.1:12345")
        
        try:
            session = device.attach(APP_NAME)
        except Exception:
            print(f"[!] 找不到進程 {APP_NAME}，嘗試使用包名附加...")
            session = device.attach(PKG_NAME)
        
        with open("hook_mid.js", "r", encoding="utf-8") as f:
            script = session.create_script(f.read())
        script.on('message', on_message)
        script.load()
        print(f"[+] Frida 注入成功，系統就緒！")
        print("====================================\n")
        return True
    except Exception as e:
        print(f"[!] Frida 初始化失敗: {e}")
        return False

def fetch_token_job():
    with emulator_lock:
        print(f"\n[*] 開始預取 (Prefetch) Token... ({time.strftime('%H:%M:%S')})")
        req_time = time.time()
        
        adb_run(["input", "tap", str(I_MAP_X), str(I_MAP_Y)])
        
        start_wait = time.time()
        success = False
        new_token = None
        
        while time.time() - start_wait < 20:
            if captured_data["token"] and captured_data["updated_at"] > req_time:
                new_token = captured_data["token"]
                print(f"[+] 預取成功！耗時: {time.time() - start_wait:.2f} 秒")
                success = True
                break
            time.sleep(0.5)
            
        adb_run(["input", "keyevent", "4"])
        time.sleep(2)
        
        with pool.lock:
            if success:
                pool.token = new_token
                pool.updated_at = time.time()
            else:
                print("[!] 預取超時，執行預防性重置...")
                open_app_and_prepare()
            pool.is_fetching = False

def start_prefetch():
    with pool.lock:
        if not pool.is_fetching:
            pool.is_fetching = True
            threading.Thread(target=fetch_token_job, daemon=True).start()

def maintain_pool():
    while True:
        needs_fetch = False
        with pool.lock:
            if pool.token is None:
                needs_fetch = True
            elif time.time() - pool.updated_at > 240:
                print(f"[*] 快取 Token 已閒置超過 4 分鐘，準備重新抓取新鮮 Token... ({time.strftime('%H:%M:%S')})")
                needs_fetch = True
                
        if needs_fetch:
            start_prefetch()
            
        time.sleep(5)

@app.route('/get_token', methods=['POST', 'OPTIONS'])
def get_token():
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200

    start_wait = time.time()
    
    while time.time() - start_wait < 25:
        with pool.lock:
            if pool.token is not None and (time.time() - pool.updated_at < 240):
                t = pool.token
                pool.token = None # 消耗掉
                print(f"[!] 瞬間回傳 Token！({time.strftime('%H:%M:%S')})")
                return jsonify({"status": "success", "mid_v": t})
        time.sleep(0.5)
        
    return jsonify({"status": "error", "message": "Timeout"}), 504

if __name__ == '__main__':
    if init_frida():
        threading.Thread(target=maintain_pool, daemon=True).start()
        print("[+] 啟動 Waitress 服務 (Port 5000)...")
        serve(app, host='0.0.0.0', port=5000, threads=4)
    else:
        print("[!] 系統異常，啟動失敗。")
        exit(1)
EOF
```

### 3. `start_farmer.sh`
包含「進程深度清理」的啟動守護腳本。
```bash
cat << 'EOF' > ~/op-farmer/start_farmer.sh
#!/bin/bash
# ~/op-farmer/start_farmer.sh

export ANDROID_HOME=$HOME/android_sdk
export ANDROID_SDK_ROOT=$HOME/android_sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator

echo "[1/4] 清理殘留程序並釋放端口..."
pkill -9 qemu-system || true
pkill -9 emulator || true
pkill -f reactive_farmer.py || true
adb kill-server > /dev/null 2>&1
fuser -k 5000/tcp > /dev/null 2>&1
rm -f $HOME/.android/avd/token_farmer.avd/*.lock

echo "[2/4] 以 1.25GB 穩定模式啟動模擬器..."
# 視主機記憶體狀況調整 memory 參數 (1280 - 2560 之間，4G 主機建議 1280M)
nohup emulator -avd token_farmer -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -writable-system -memory 1280 -no-snapshot-load -no-metrics -no-passive-gps > $HOME/op-farmer/emulator.log 2>&1 &

echo "等待裝置載入..."
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]; do sleep 3; done
sleep 5

echo "[3/4] 啟動 Frida Server..."
adb root && adb wait-for-device
adb shell 'setenforce 0; nohup /data/local/tmp/asdf -l 0.0.0.0:12345 >/dev/null 2>&1 &'
sleep 3

# 驗證 Frida Server 是否正在運行
if adb shell 'ps -A | grep asdf' | grep -q asdf; then
    echo "[+] Frida Server 啟動成功"
else
    echo "[!] Frida Server 啟動失敗，請檢查 /data/local/tmp/asdf 是否完整"
    exit 1
fi

echo "[4/4] 啟動農場 API 服務..."
cd $HOME/op-farmer
source venv/bin/activate
adb forward tcp:12345 tcp:12345
python -u reactive_farmer.py
EOF

chmod +x ~/op-farmer/start_farmer.sh
```

---

## 四、 啟動與自動化驗證

### 1. 啟動農場
建議使用 `nohup` 確保您離線後服務持續運行：
```bash
cd ~/op-farmer
nohup ./start_farmer.sh > farmer_live.log 2>&1 &
```

> **注意**：首次啟動需要約 1-2 分鐘等待模擬器開機及 App 預熱。您可以透過 `tail -f farmer_live.log` 觀察進度，直到看見 `啟動 Waitress 服務 (Port 5000)` 表示就緒。

### 2. 測試 Token 抓取
使用任何 HTTP 工具 (如 `curl`, `Postman`) 發送 POST 請求至 5000 端口：
```bash
# 在伺服器本地測試：
curl -X POST http://localhost:5000/get_token

# 從其他機器遠端測試 (將 server_ip 替換為伺服器 IP)：
curl -X POST http://server_ip:5000/get_token
```

### 3. 返回結果格式
執行成功後，您會得到如下格式的 JSON 回應：
```json
{
  "mid_v": "W0_JiF5--gVEUoI2XK91G5fxcSBCcajCzaarz7YOBYQ66r8NWn...",
  "status": "success"
}
```

---

## 五、 疑難排解

### Frida Server 啟動失敗 (Segmentation fault)
如果 Frida Server 執行時出現 `Segmentation fault`，代表 binary 在傳輸過程中損壞。請重新下載：
```bash
cd /tmp
rm -f asdf
wget https://github.com/frida/frida/releases/download/16.2.1/frida-server-16.2.1-android-x86_64.xz
unxz frida-server-16.2.1-android-x86_64.xz
mv frida-server-16.2.1-android-x86_64 asdf
adb push asdf /data/local/tmp/
adb shell "chmod 755 /data/local/tmp/asdf"
# 驗證
adb shell "/data/local/tmp/asdf --version"   # 應輸出 16.2.1
```

### 模擬器啟動失敗 (Qt platform plugin error)
在無圖形介面的伺服器上，如果模擬器啟動時報錯 `This application failed to start because no Qt platform plugin could be initialized`，請確保使用 `-no-window` 參數啟動模擬器。

### sdkmanager 報錯 (UnsupportedClassVersionError)
如果執行 `sdkmanager` 時出現 `UnsupportedClassVersionError: class file version 61.0`，代表您的 Java 版本過舊。最新的 Android SDK cmdline-tools 需要 Java 17：
```bash
sudo apt install -y openjdk-17-jdk
java -version   # 應顯示 17.x
```

### 模擬器報錯 (Cannot find AVD system path)
如果模擬器啟動時報錯 `Cannot find AVD system path. Please define ANDROID_SDK_ROOT`，請確保環境變數已正確設定：
```bash
export ANDROID_SDK_ROOT=$HOME/android_sdk
```

---

## 六、 運作原理與優化重點 (Why It Works)
*   **不被系統彈窗阻撓**：過去在抓取完成、執行返回鍵時，容易觸發 App 的「是否退出APP」對話框。本版利用 Frida 從底層攔截了帶有 `Exit/Quit` 標籤的 `Dialog.show()`，讓 UI 單純執行「返回」指令而無後顧之憂。
*   **五步閉環操作**：每次收到 `curl`，系統必定強制從頭執行 **「1. 確保在前台 -> 2. 點擊空白關廣告 -> 3. 點擊首頁標籤待命 -> 4. 點擊 i地圖 -> 5. 等待回傳後按一次返回」**，消除了多次查詢產生的狀態偏移與不可控因素。
*   **記憶體容錯**：`config.ini` 中的 `vm.heapSize=512M` 與啟動腳本中的限制，達到了在廉價/低配伺服器上長期生存的最佳平衡點。
*   **Headless 友善**：全程使用 `-no-window` 模式，不依賴 X11 顯示服務，可在任何無 GUI 的伺服器上穩定運行。
