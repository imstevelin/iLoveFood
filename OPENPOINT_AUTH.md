# OPEN POINT 個人識別資料初始化

本文件依 7-ELEVEN App 5.73.0 的實作整理，用於維護者在自己的帳號上一次性取得 GID、MID、VCode。請勿把帳密、callback URL、授權 code、access token、識別資料或 App 金鑰提交進 Git。

## 使用工具

將本機合法持有的 APK 中 `client_mima`、`AES_KEY_FOR_AesAWSEncryption_RELEASE`、`AES_IV_FOR_AesAWSEncryption_RELEASE` 對應值填入私密環境檔：

```bash
cp openpoint-auth.env.example .env.openpoint
```

產生含新 UUID 與台北當下時間的官方登入網址：

```bash
npm run openpoint:login-url
```

在官方頁面手動登入並完成圖形驗證碼。登入後取得完整的 `seveneleven://711?return_code=00&v=...` callback；未安裝 App 時，可在 DevTools Console 找 `Failed to launch 'seveneleven://...'` 訊息。接著在本機換取識別資料：

```bash
npm run openpoint:exchange -- 'seveneleven://711?return_code=00&v=...'
```

工具不接收帳密、不寫檔，也不保存短效 code 或 access token。輸出的 GID、MID、VCode 應立即設為 Worker Secrets，終端歷史若含 callback URL 則應清除。三項值目前看來長期穩定，但官方沒有保證永久有效。

## 協定鏈

```text
登入網址 v ──AES-256-CBC──> AuthRequest
callback v ──AES-256-CBC──> code
code ──AccessToken.html──> access_token
access_token ──QueryMemberMID.html──> MID
access_token + MID ──QueryMemberGID.html──> GID
                   └─QueryMemberVcode.html──> VCode

GID + MID + VCode + iMAP key ──AES-256-GCM──> mid_v
```

登入換證與 `mid_v` 使用不同金鑰及不同 AES mode，不可混用。callback 的 `v` 只能解出 code；GID、MID、VCode 必須由官方伺服器回傳，並非可由網址完全離線推導。

## 編碼定義

```text
C = "711App"
M = client_mima
R = callback AuthResponse.request_id（登入流程原先產生的 UUID）
U = "seveneleven://711"
T = Asia/Taipei 當下時間，yyyyMMddHHmmss
P = "IOFT85"
S = "mX8pRu"

MD5HEX(x) = UTF-8(x) 的 MD5 小寫十六進位
ENC(x) = Base64.NO_WRAP(AES-256-CBC-PKCS5Padding(UTF-8(JSON(x))))
DEC(x) = JSON.parse(AES-256-CBC-PKCS5Padding-DECRYPT(Base64Decode(x)))
```

各請求的 mask 是下列字串直接相接後取 `MD5HEX`，不加入分隔符號：

```text
Auth:        P + C + M + R + U                 + T + S
AccessToken: P + C + M + R + code              + T + S
MID:         P + C + M + R + access_token      + T + S
GID/VCode:   P + C + M + R + access_token + MID + T + S
```

`AuthRequest` 加密後放進：

```text
GET https://auth.openpoint.com.tw/SETMemberAuth/Auth.html?client_id=711App&v=<URL_ENCODE(ENC(payload))>
```

其餘請求使用 `Content-Type: application/x-www-form-urlencoded`，body 均為 `client_id=711App&v=<URL_ENCODE(ENC(payload))>`：

```text
POST https://auth.openpoint.com.tw/SETMemberAuth/AccessToken.html
POST https://auth.openpoint.com.tw/SETMemberAuth/QueryMemberMID.html
POST https://auth.openpoint.com.tw/SETMemberAuth/QueryMemberGID.html
POST https://auth.openpoint.com.tw/SETMemberAuth/QueryMemberVcode.html
```

每個請求使用送出當下的新 `T` 並重算 mask。JavaScript 的 `URLSearchParams.get('v')` 已做過 percent decode，不可再呼叫 `decodeURIComponent`。

## 驗證依據

- App 的登入 helper 建立 `client_id`、`client_mima`、`request_id`、`redirect_uri`、`request_time` 與 MD5 mask。
- AES helper 使用 `AES/CBC/PKCS5Padding` 與無換行 Base64。
- callback handler 解密 `v` 為 AuthResponse，取出 `code` 後依序呼叫上述端點。
- `mid_v` 的另一段 AES-256-GCM 實作已由 `worker/openpoint-midv.test.mjs` 與實際 access-token 兌換驗證。
