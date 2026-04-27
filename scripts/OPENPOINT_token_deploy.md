# 🚀 OPENPOINT Token 自動化農場部署指南

本指南將引導您從零開始，在無圖形介面 (Headless) 的 Ubuntu 伺服器上部署 OPENPOINT Token (`mid_v`) 自動化抓取系統。
此版本特別針對 **4GB RAM 伺服器** 進行了極致優化，解決了 App 閃退、虛擬機掉線、系統彈窗阻撓及連續抓取失敗等痛點。

---

## 系統需求
*   **宿主機**: Ubuntu 20.04 或 22.04 (支援 KVM 虛擬化)
*   **硬體資源**: 至少 4GB RAM (建議保留 1.5GB ~ 2.5GB 給模擬器使用)
*   **本地環境**: 需準備一台有圖形介面的電腦 (Windows/Mac/Linux) 用於首次遠端畫面投射與人工登入。

---

## 一、 伺服器環境安裝

### 1. 安裝基礎套件與 Android SDK
在您的 Ubuntu 伺服器上執行以下指令：
```bash
sudo apt update
sudo apt install -y openjdk-11-jdk bridge-utils cpu-checker libvirt-clients libvirt-daemon-system qemu-kvm virt-manager adb nmap python3-pip python3-venv psmisc wget unzip scrcpy

# 下載並配置 Android SDK
mkdir -p ~/android_sdk/cmdline-tools
cd ~/android_sdk/cmdline-tools
wget https://dl.google.com/android/repository/commandlinetools-linux-10406996_latest.zip
unzip commandlinetools-linux-*_latest.zip
mv cmdline-tools latest

# 設定環境變數 (請將以下內容加入至 ~/.bashrc，並執行 source ~/.bashrc)
export ANDROID_HOME=$HOME/android_sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
```

### 2. 建立並優化虛擬機 (AVD)
```bash
# 下載系統映像檔 (強烈建議使用 API 30)
yes | sdkmanager "system-images;android-30;google_apis;x86_64"

# 建立 AVD
avdmanager create avd -n token_farmer -k "system-images;android-30;google_apis;x86_64" --force

# 【關鍵步驟】優化硬體配置，解決 App 閃退問題
sed -i 's/hw.ramSize =.*/hw.ramSize = 2560M/' ~/.android/avd/token_farmer.avd/config.ini
sed -i 's/vm.heapSize =.*/vm.heapSize = 512M/' ~/.android/avd/token_farmer.avd/config.ini
echo "hw.cpu.ncore = 2" >> ~/.android/avd/token_farmer.avd/config.ini
echo "hw.lcd.density = 120" >> ~/.android/avd/token_farmer.avd/config.ini
```

### 3. 配置 Python 虛擬環境
```bash
mkdir -p ~/op-farmer && cd ~/op-farmer
python3 -m venv venv
source venv/bin/activate
# 指定 Frida 版本以確保穩定性
pip install flask flask-cors waitress frida==16.2.1 frida-tools==12.3.0
```

---

## 二、 遠端畫面投射與人工登入 (首次環境建置)

為了讓農場腳本能夠運作，您必須先**手動安裝 OpenPoint APP 並完成登入**。

### 1. 在伺服器端啟動模擬器
請在伺服器上以帶有畫面輸出的模式 (需配合 scrcpy) 啟動模擬器：
```bash
# 啟動模擬器
nohup emulator -avd token_farmer -no-audio -gpu swiftshader_indirect -writable-system -memory 2560 -no-snapshot-load > emulator_init.log 2>&1 &

# 等待模擬器開機
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" == "1" ]; do sleep 3; done
```

### 2. 從本地端連線並登入
請回到您的**本地電腦 (Windows/Mac/Linux)** 上進行操作：

1.  **建立 SSH 隧道**: 將伺服器的 ADB port (5037) 轉發到本地。打開本地終端機輸入：
    ```bash
    # 將 user 替換為您的伺服器帳號，server_ip 替換為伺服器 IP
    ssh -L 5037:localhost:5037 user@server_ip
    ```
2.  **連接並投射畫面**: 保持 SSH 隧道開啟，開啟另一個本地終端機輸入：
    ```bash
    # 讓本地 ADB 連接伺服器上的模擬器
    adb connect localhost:5554
    # 啟動本地 scrcpy 觀看伺服器模擬器畫面
    scrcpy -s localhost:5554
    ```

### 3. 安裝 APP 與登入
現在您應該能在本地看到伺服器模擬器的畫面了。
1.  下載 OpenPoint APP 的 APK 檔案到您的本地電腦。
2.  透過 ADB 安裝：
    ```bash
    adb -s localhost:5554 install /path/to/openpoint.apk
    ```
3.  **人工登入**:
    *   在 scrcpy 畫面中打開 OpenPoint APP。
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
sleep 60
adb root && adb wait-for-device
adb push asdf /data/local/tmp/
adb shell "chmod +x /data/local/tmp/asdf"
adb emu kill
```

---

## 三、 部署核心腳本

請在伺服器的 `~/op-farmer` 目錄下建立以下三個檔案：

### 1. `hook_mid.js`
此腳本負責攔截 Token 並自動屏蔽干擾 UI 的系統彈窗。
```bash
nano ~/op-farmer/hook_mid.js
```
寫入以下內容：
```javascript
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
```

### 2. `reactive_farmer.py`
重構後的 Python 服務，採用「五步智慧 UI 操作鏈」。
```bash
nano ~/op-farmer/reactive_farmer.py
```
寫入以下內容：
```python
# ~/op-farmer/reactive_farmer.py
import frida, time, subprocess, threading
from flask import Flask, jsonify, request
from flask_cors import CORS
from waitress import serve

app = Flask(__name__)
CORS(app)

# 穩定版座標設定 (MDPI 120-160 適用)
SAFE_BLANK_X, SAFE_BLANK_Y = 10, 50     # 點擊空白處關廣告
SERVICE_TAB_X, SERVICE_TAB_Y = 220, 615 # 底部 Service 選單
I_MAP_X, I_MAP_Y = 219, 533             # i地圖按鈕
APP_NAME = "OPENPOINT"
PKG_NAME = "tw.net.pic.m.openpoint"

captured_data = {"token": None, "updated_at": 0}
emulator_lock = threading.Lock()

def on_message(message, data):
    if message['type'] == 'send':
        payload = message['payload']
        if payload.get('type') == 'token_captured':
            captured_data["token"] = payload['mid_v']
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

    print("[*] 切換至 Service 選單...")
    adb_run(["input", "tap", str(SERVICE_TAB_X), str(SERVICE_TAB_Y)])
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

@app.route('/get_token', methods=['POST', 'OPTIONS'])
def get_token():
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200

    print(f"\n[!] 收到查詢請求 ({time.strftime('%H:%M:%S')})")
    with emulator_lock:
        request_time = time.time()
        
        # 觸發抓取流程
        print("[*] 點擊 i地圖 觸發 Token 產生...")
        adb_run(["input", "tap", str(I_MAP_X), str(I_MAP_Y)])
        
        start_wait = time.time()
        success = False
        token = None
        
        while time.time() - start_wait < 20:
            if captured_data["token"] and captured_data["updated_at"] > request_time:
                token = captured_data["token"]
                print(f"[+] 抓取成功！耗時: {time.time() - start_wait:.2f} 秒")
                success = True
                break
            time.sleep(0.5)
        
        # 執行單次返回，停留在 Service 頁面待命
        print("[*] 執行返回並回到待命狀態...")
        adb_run(["input", "keyevent", "4"])
        time.sleep(2)

        if success:
            return jsonify({"status": "success", "mid_v": token})
        else:
            print("[!] 抓取超時，執行預防性重置...")
            open_app_and_prepare()
            return jsonify({"status": "error", "message": "Timeout"}), 504

if __name__ == '__main__':
    if init_frida():
        print("[+] 啟動 Waitress 服務 (Port 5000)...")
        serve(app, host='0.0.0.0', port=5000, threads=4)
    else:
        print("[!] 系統異常，啟動失敗。")
        exit(1)
```

### 3. `start_farmer.sh`
包含「進程深度清理」的啟動守護腳本。
```bash
nano ~/op-farmer/start_farmer.sh
```
寫入以下內容：
```bash
#!/bin/bash
# ~/op-farmer/start_farmer.sh

export ANDROID_HOME=$HOME/android_sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator

echo "[1/4] 清理殘留程序並釋放端口..."
pkill -9 qemu-system
pkill -9 emulator
pkill -f reactive_farmer.py
adb kill-server > /dev/null 2>&1
fuser -k 5000/tcp > /dev/null 2>&1
rm -f $HOME/.android/avd/token_farmer.avd/*.lock

echo "[2/4] 以 1.25GB 穩定模式啟動模擬器..."
# 視主機記憶體狀況調整 memory 參數 (1280 - 2560 之間，4G 主機建議 1280M)
nohup emulator -avd token_farmer -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -writable-system -memory 1280 -no-snapshot-load -no-metrics -no-passive-gps > $HOME/op-farmer/emulator.log 2>&1 &
EMU_PID=$!

echo "等待裝置載入..."
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]; do sleep 3; done
sleep 5

echo "[3/4] 啟動 Frida Server..."
adb root && adb wait-for-device
adb shell 'setenforce 0; export LD_LIBRARY_PATH=/apex/com.android.runtime/lib64:/apex/com.android.art/lib64:/system/lib64:/vendor/lib64; nohup /data/local/tmp/asdf -l 0.0.0.0:12345 >/dev/null 2>&1 &'
sleep 3

echo "[4/4] 啟動農場 API 服務..."
cd $HOME/op-farmer
source venv/bin/activate
python -u reactive_farmer.py
```
給予腳本執行權限：
```bash
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
# 在本地端測試：
curl -X POST http://localhost:5000/get_token
```

### 3. 返回結果格式
執行成功後，您會得到如下格式的 JSON 回應：
```json
{
  "mid_v": "v1.abcd1234efgh...",
  "status": "success"
}
```

---

## 五、 運作原理與優化重點 (Why It Works)
*   **不被系統彈窗阻撓**：過去在抓取完成、執行返回鍵時，容易觸發 OpenPoint 的「是否退出APP」對話框。本版利用 Frida 從底層攔截了帶有 `Exit/Quit` 標籤的 `Dialog.show()`，讓 UI 單純執行「返回」指令而無後顧之憂。
*   **五步閉環操作**：每次收到 `curl`，系統必定強制從頭執行 **「1. 確保在前台 -> 2. 點擊空白關廣告 -> 3. 點擊 Service 標籤 -> 4. 點擊 i地圖 -> 5. 等待回傳後按一次返回」**，消除了多次查詢產生的狀態偏移與不可控因素。
*   **記憶體容錯**：`config.ini` 中的 `vm.heapSize=512M` 與啟動腳本中的限制，達到了在廉價/低配伺服器上長期生存的最佳平衡點。
