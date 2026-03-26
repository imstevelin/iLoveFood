# OPENPOINT Token (`mid_v`) 極速全自動農場部署指南

本指南詳細記錄如何在運行於 Proxmox VE (PVE) 的 Ubuntu Server 上，從零建置 Android 模擬器，並結合 Frida、Flask-CORS 與 Waitress 伺服器，打造一套「毫秒級回應、高併發穩定」的被動觸發式 Token 抓取系統。

## ⚙️ 系統要求與硬體解鎖 (PVE 端)

* **作業系統**：Ubuntu Server (推薦 22.04 或 24.04)
* **硬體環境**：Proxmox VE (PVE) 虛擬機
* **PVE 效能解鎖 (至關重要)**：
    1. 進入 PVE 管理介面，將 Ubuntu 虛擬機徹底關機 (`sudo poweroff`)。
    2. 點擊該虛擬機的 **Hardware** -> **Processors**。
    3. 將 **Type** 更改為 **`host`** (啟動 KVM 硬體加速的關鍵)。
    4. 將 **Cores** 設定為至少 **4** 核心。
    5. 從 PVE 介面重新冷開機 (Start) 虛擬機。

---

## 🛠️ Step 1：解除 Linux KVM 權限與安裝 Java

進入 Ubuntu 終端機，首先開通硬體加速權限，並準備 Android SDK 所需的 Java 17 環境。

```bash
# 1. 將當前使用者加入 kvm 群組，開通硬體加速權限
sudo usermod -aG kvm $USER
sudo chown root:kvm /dev/kvm
sudo chmod 660 /dev/kvm

# 2. 安裝 Java 17 與必備工具
sudo apt update
sudo apt install -y openjdk-17-jdk unzip python3-venv python3-full
```

---

## 📦 Step 2：建置 Android SDK 與模擬器 (AVD)

```bash
# 1. 下載並配置官方 Command Line Tools
mkdir -p ~/android_sdk/cmdline-tools
cd ~/android_sdk/cmdline-tools
wget [https://dl.google.com/android/repository/commandlinetools-linux-11479570_latest.zip](https://dl.google.com/android/repository/commandlinetools-linux-11479570_latest.zip)
unzip commandlinetools-linux-*_latest.zip
rm commandlinetools-linux-*_latest.zip
mv cmdline-tools latest

# 2. 設定全域環境變數
echo 'export ANDROID_HOME=$HOME/android_sdk' >> ~/.bashrc
echo 'export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator' >> ~/.bashrc
source ~/.bashrc

# 3. 下載 Android 11 (API 30) 映像檔
yes | sdkmanager --licenses
sdkmanager "system-images;android-30;google_apis;x86_64" "emulator" "platform-tools"

# 4. 建立虛擬機並強制啟用 4 核心
avdmanager create avd -n token_farmer -k "system-images;android-30;google_apis;x86_64"
CONFIG_FILE="$HOME/.android/avd/token_farmer.avd/config.ini"
sed -i 's/^hw.cpu.ncore.*/hw.cpu.ncore=4/g' "$CONFIG_FILE"
grep -q "^hw.cpu.ncore" "$CONFIG_FILE" || echo "hw.cpu.ncore=4" >> "$CONFIG_FILE"

# 5. 首次背景啟動模擬器 (需等待 1~2 分鐘)
emulator -avd token_farmer -no-window -gpu swiftshader_indirect -writable-system &
```

---

## 🌉 Step 3：遠端畫面投射與人工登入

透過 SSH 隧道將伺服器的 Android 畫面投射至你的個人電腦 (Mac/Windows) 進行首次登入。

1.  **在本機電腦終端機建立 SSH 隧道**：
    ```bash
    # 請替換為你的 Ubuntu 使用者名稱與伺服器 IP
    ssh -N -L 5555:localhost:5555 ubuntu_user@server_ip
    ```
2.  **在本機電腦開啟新終端機，啟動 Scrcpy**：
    ```bash
    adb connect localhost:5555
    scrcpy -s localhost:5555
    ```
3.  **人工登入作業**：
    將 `OPENPOINT` 的 APK 檔案拖曳進 Scrcpy 畫面安裝，輸入帳號密碼完成登入。確認停留在首頁後，即可關閉 Scrcpy。

---

## 💉 Step 4：部署 Frida Server

回到 **Ubuntu 終端機**，下載並植入與 Python 端完全一致的 `16.2.1` 版 Frida。

```bash
mkdir -p ~/frida_tmp && cd ~/frida_tmp

# 下載 16.2.1 版 Frida Server
wget [https://github.com/frida/frida/releases/download/16.2.1/frida-server-16.2.1-android-x86_64.xz](https://github.com/frida/frida/releases/download/16.2.1/frida-server-16.2.1-android-x86_64.xz)
xz -d frida-server-16.2.1-android-x86_64.xz

# 改名以躲避偵測，並推送到 Android 系統
mv frida-server-16.2.1-android-x86_64 asdf
adb push asdf /data/local/tmp/
```

---

## 🤖 Step 5：建置企業級 Python API

建立獨立虛擬環境，安裝生產級伺服器 Waitress 與 CORS 支援，並寫入雙重攔截腳本與狙擊模式控制台。

```bash
# 1. 建立虛擬環境與安裝核心套件 (強制鎖定 Frida 版本)
mkdir -p ~/op-farmer && cd ~/op-farmer
python3 -m venv venv
source venv/bin/activate
pip install frida==16.2.1 flask flask-cors waitress requests frida-tools

# 2. 寫入 JS 攔截腳本 (動態 URL 與 Cookie 雙重攔截)
cat << 'EOF' > hook_mid.js
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
});
EOF

# 3. 寫入 Python 主程式 (Waitress + 執行緒鎖 + 狙擊待命模式)
cat << 'EOF' > reactive_farmer.py
import frida
import time
import subprocess
import threading
from flask import Flask, jsonify, request
from flask_cors import CORS
from waitress import serve

app = Flask(__name__)
CORS(app)

SAFE_BLANK_X, SAFE_BLANK_Y = 10, 50
SERVICE_X, SERVICE_Y = 220, 615
TARGET_X, TARGET_Y = 219, 533
APP_NAME = "OPENPOINT"

captured_data = {"token": None, "updated_at": 0}
emulator_lock = threading.Lock()

def on_message(message, data):
    if message['type'] == 'send':
        payload = message['payload']
        if payload.get('type') == 'token_captured':
            captured_data["token"] = payload['mid_v']
            captured_data["updated_at"] = time.time()

def reset_to_standby_mode():
    print("[*] 執行 APP 絕對重置與預熱程序...")
    subprocess.run(["adb", "shell", "svc", "power", "stayon", "true"])
    subprocess.run(["adb", "shell", "am", "force-stop", "tw.net.pic.m.openpoint"])
    time.sleep(2)
    
    subprocess.run(["adb", "shell", "monkey", "-p", "tw.net.pic.m.openpoint", "-c", "android.intent.category.LAUNCHER", "1"], stdout=subprocess.DEVNULL)
    time.sleep(10) 
    
    subprocess.run(["adb", "shell", "input", "tap", str(SAFE_BLANK_X), str(SAFE_BLANK_Y)])
    time.sleep(2)
    
    subprocess.run(["adb", "shell", "input", "tap", str(SERVICE_X), str(SERVICE_Y)])
    time.sleep(5)
    print("[*] 已就位至 Service 頁面，狙擊模式待命中。")

def init_frida():
    try:
        reset_to_standby_mode()
        subprocess.run(["adb", "forward", "tcp:12345", "tcp:12345"])
        device = frida.get_device_manager().add_remote_device("127.0.0.1:12345")
        session = device.attach(APP_NAME)
        
        with open("hook_mid.js", "r", encoding="utf-8") as f:
            script = session.create_script(f.read())
        script.on('message', on_message)
        script.load()
        print("[+] Frida 注入成功，農場已進入極速待命狀態！")
        return True
    except Exception as e:
        print(f"[!] Frida 初始化失敗: {e}")
        return False

@app.route('/get_token', methods=['POST', 'OPTIONS'])
def get_token():
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200

    with emulator_lock:
        request_time = time.time()
        subprocess.run(["adb", "shell", "input", "tap", str(TARGET_X), str(TARGET_Y)])
        
        start_wait = time.time()
        while time.time() - start_wait < 15:
            if captured_data["token"] and captured_data["updated_at"] > request_time:
                token = captured_data["token"]
                subprocess.run(["adb", "shell", "input", "keyevent", "4"])
                return jsonify({"status": "success", "mid_v": token})
            time.sleep(0.2)
        
        reset_to_standby_mode()
        return jsonify({"status": "error", "message": "Timeout, triggering self-healing"}), 504

if __name__ == '__main__':
    if init_frida():
        serve(app, host='0.0.0.0', port=5000, threads=4)
EOF
```

---

## 🚀 Step 6：Systemd 守護進程 (開機自啟與崩潰還原)

撰寫總管腳本，確保系統重啟時能依序拉起 ADB、模擬器、Root 權限、Frida 與 API 伺服器。

```bash
# 1. 建立自動化總管腳本
cat << 'EOF' > ~/op-farmer/start_farmer.sh
#!/bin/bash
export ANDROID_HOME=$HOME/android_sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export ANDROID_AVD_HOME=$HOME/.android/avd
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator

killall -9 qemu-system-x86_64 > /dev/null 2>&1
adb kill-server > /dev/null 2>&1
sleep 2

adb start-server
emulator -avd token_farmer -no-window -gpu swiftshader_indirect -writable-system > $HOME/op-farmer/emulator.log 2>&1 &
EMU_PID=$!

while true; do
    if ! kill -0 $EMU_PID 2>/dev/null; then
        exit 1
    fi
    BOOT_STATUS=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
    if [ "$BOOT_STATUS" == "1" ]; then break; fi
    sleep 3
done
sleep 5

adb root
sleep 3
adb wait-for-device
adb shell 'setenforce 0; export LD_LIBRARY_PATH=/apex/com.android.runtime/lib64:/apex/com.android.art/lib64:/system/lib64:/vendor/lib64; nohup /data/local/tmp/asdf -l 0.0.0.0:12345 >/dev/null 2>&1 &'
sleep 3

cd $HOME/op-farmer
source venv/bin/activate
exec python reactive_farmer.py
EOF

chmod +x ~/op-farmer/start_farmer.sh

# 2. 註冊 Systemd 服務
cat << EOF | sudo tee /etc/systemd/system/token-farmer.service
[Unit]
Description=OPEN POINT Token Farmer Automation Service
After=network.target

[Service]
Type=simple
User=$USER
Environment="HOME=$HOME"
Environment="USER=$USER"
WorkingDirectory=$HOME/op-farmer
ExecStart=/bin/bash $HOME/op-farmer/start_farmer.sh
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
EOF

# 3. 啟動並設定開機自動執行
sudo systemctl daemon-reload
sudo systemctl enable token-farmer
sudo systemctl start token-farmer
```

---

## 🎯 測試與維護指令

一切就緒後，前端網站即可透過 JavaScript `fetch` 無縫呼叫 API：

```bash
# 終端機測試指令
curl -X POST http://[Ubuntu_伺服器_IP]:5000/get_token
```

### 必備維護指令：
* **查看即時運行 Log**：`journalctl -u token-farmer -f`
* **手動重啟整個農場**：`sudo systemctl restart token-farmer`
* **停止服務**：`sudo systemctl stop token-farmer`