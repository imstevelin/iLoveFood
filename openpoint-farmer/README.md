# OPENPOINT `mid_v` Farmer

農場相關的程式、Docker 部署檔與維運文件都集中在這個目錄。公開映像同時支援 `linux/amd64` 與 `linux/arm64`，其中 x86_64 Linux 已完成實機驗收。

映像：[`imstevelin/ilovefood-openpoint-farmer`](https://hub.docker.com/r/imstevelin/ilovefood-openpoint-farmer) (`2026.09` 為固定版本，`latest` 指向目前穩定版)

## 從 Docker Hub 部署

目標主機必須是支援 BinderFS 的 Linux。先取得部署檔後執行：

```bash
git clone https://github.com/imstevelin/iLoveFood.git
cd iLoveFood/openpoint-farmer/docker
./setup-linux-host.sh
cp .env.example .env
install -d -m 700 private
umask 077
openssl rand -hex 32 > private/farmer_api_key.txt
docker compose pull
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:5000/health
```

目標主機不需要 APK、bootstrap 檔案、舊 VM 或舊 Android volume；這些執行所需狀態已包含在發布映像中。`farmer_api_key.txt` 是每個部署自行建立的 API 存取金鑰，不是 OPENPOINT 身分。

若主機沒有 Compose 外掛：

```bash
./run-standalone.sh
```

查詢 Token：

```bash
api_key="$(sed -n '1p' private/farmer_api_key.txt)"
curl -fsS -X POST http://127.0.0.1:5000/get_token \
  -H "Authorization: Bearer ${api_key}"
unset api_key
```

## 從原始碼重新建置

只有維護或重新發布映像時，才需要本機私密建置資產：

```text
docker/private/openpoint.apk
docker/private/bootstrap-prefs.xml
```

建置離線 x86_64 + ARM64 OCI 封存：

```bash
cd docker
./build-multiarch.sh --oci
```

發布到 Docker Hub：

```bash
FARMER_IMAGE=imstevelin/ilovefood-openpoint-farmer:2026.09 \
  ./build-multiarch.sh --push
```

映像依擁有者要求包含可直接啟動的 OPENPOINT 假名化識別狀態，但不包含 Farmer API key。完整的主機要求、架構說明、實測數據、Android 畫面連線與回滾方式請見 [DEPLOYMENT.md](./DEPLOYMENT.md)。
