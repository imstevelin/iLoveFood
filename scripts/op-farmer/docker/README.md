# OPENPOINT Farmer Container

這個目錄將 Android 12 reDroid、OPENPOINT App、Frida 16.2.1 與 Python `mid_v` API 封裝在單一 Docker 映像。正式運行平台為支援 BinderFS 的 x86_64 Linux；Dockerfile 也可建置 `linux/arm64` 映像。

## Quick start

```bash
./setup-linux-host.sh
cp .env.example .env
install -d -m 700 private
# 將 API key 寫入 private/farmer_api_key.txt，檔案權限設為 600
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:5000/health
```

若主機只有 Docker Engine、沒有 Compose 外掛，可以改用等價的：

```bash
./run-standalone.sh
```

建置前必須有下列三個未納入 Git 的私密檔案：

```text
private/openpoint.apk
private/bootstrap-prefs.xml
private/farmer_api_key.txt
```

建置離線 x86_64 + ARM64 OCI 封存：

```bash
./build-multiarch.sh --oci
```

發布到私有 registry：

```bash
FARMER_IMAGE=registry.example.com/ilovefood/op-farmer:2026.09 \
  ./build-multiarch.sh --push
```

完整的主機要求、bootstrap 匯出、API 用法、Android 畫面連線、實測數據與疑難排解請見 [`../../OPENPOINT_token_deploy.md`](../../OPENPOINT_token_deploy.md)。
