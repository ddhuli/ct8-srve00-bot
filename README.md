# Cloudflare Worker 自动登录并推送 Telegram 消息

## 项目简介
本项目为 Cloudflare Worker 脚本，支持定时自动登录多个网站账号，并将登录结果通过 Telegram 机器人推送到您的 Telegram。

---

## 目录结构
```
github/
└── login-bot/
    └── Worker.js    # 主脚本（含详细注释和安全加固）
    └── README.md    # 中文部署说明（本文件）
```

---

## 使用前准备
1. **注册并登录 [Cloudflare](https://dash.cloudflare.com/) 账号**
2. **创建 Telegram 机器人**，获取 Bot Token 和您的 User ID
3. **准备好所有需要自动登录的账号信息**

---

## 环境变量说明
在 Cloudflare Worker 的环境变量（Variables）中设置以下三个变量：

### 1. ACCOUNTS_JSON
账号信息，格式如下：
```json
[
  {"username": "user1", "password": "pass1", "panelnum": "1", "type": "serv00"},
  {"username": "user2", "password": "pass2", "panelnum": "", "type": "ct8"}
]
```
- `username`：登录账号
- `password`：登录密码
- `panelnum`：面板编号（ct8 类型可留空）
- `type`：面板类型（ct8 或 serv00）

### 2. TELEGRAM_JSON
Telegram 配置，格式如下：
```json
{"telegramBotToken": "xxxx:xxxxxxxx", "telegramBotUserId": "123456789"}
```
- `telegramBotToken`：您的 Telegram 机器人 Token
- `telegramBotUserId`：您的 Telegram 用户ID

### 3. （自动批次，无需手动设置 BATCH_INDEX）
批次编号将自动记录在 Cloudflare Worker 的 KV 存储中，每次自动递增，无需人工干预。
- Worker 会自动分批处理账号，每批3个。
- 处理完全部账号后，批次编号自动重置为0。

#### KV 命名空间绑定说明
请在 Worker 的 wrangler.toml 或 Cloudflare 控制台绑定一个 KV 命名空间，建议命名为 `LOGIN_BATCH_KV`。
例如 wrangler.toml 配置：
```toml
[[kv_namespaces]]
binding = "LOGIN_BATCH_KV"
id = "xxxxxx"
```

## 使用说明

### 2. 上传代码
- 在 Cloudflare Worker 控制台新建 Worker 项目。
- 上传 `Worker.js` 代码（或粘贴到在线编辑器）。

### 3. 配置环境变量
- 在 Worker 设置页面添加：
  - `ACCOUNTS_JSON`：账号信息数组，例如：
    ```json
    [
      {"username": "user1", "password": "pass1", "panelnum": "1", "type": "serv00"}
    ]
    ```
  - `TELEGRAM_JSON`：Telegram Bot 配置，例如：
    ```json
    { "telegramBotToken": "xxxx:xxxxxxxx", "telegramBotUserId": "123456789" }
    ```

### 4. 绑定 KV 命名空间
- 在 Cloudflare 控制台“存储 > KV 命名空间”新建并绑定，绑定名需与代码一致（`LOGIN_BATCH_KV`）。
- 也可通过 wrangler.toml 文件绑定：
  ```toml
  [[kv_namespaces]]
  binding = "LOGIN_BATCH_KV"
  id = "xxxxxx"
  ```

### 5. 配置定时任务（Cron Trigger）
- 在“触发器”页面添加：
  - 每天凌晨1点归零：
    ```
    0 17 * * *
    ```
  - 每天凌晨1:05~1:55，每5分钟分批处理：
    ```
    5-55/5 17 * * *
    ```
- 说明：Cloudflare Worker 使用 UTC 时间，`0 17 * * *` 实际对应北京时间凌晨1点。

### 6. 保存并部署
- 点击“保存并部署”按钮。

### 7. 测试与排障建议
- 在 Telegram 上关注您的机器人。
- 触发 Worker，查看是否收到推送消息。
- 若首次部署后未收到 Telegram 消息，可在 Worker 控制台查看日志，确认环境变量和 KV 绑定无误。

### 8. 常见问题
- 如遇异常，可在 Cloudflare Worker 日志排查。
- 批次大小、定时频率等参数可在 Worker.js 里调整。

#### FAQ 常见问题举例

- **Q: Worker 日志报错 “KV namespace not bound”？**  
  A: 请检查 wrangler.toml 或 Cloudflare 控制台，确保已正确绑定名为 LOGIN_BATCH_KV 的 KV 命名空间。

- **Q: Telegram 没收到推送？**  
  A: 检查 TELEGRAM_JSON 是否配置正确，Bot 是否已启动，User ID 是否填写为自己的 Telegram 数字ID。

- **Q: 如何修改每批处理账号数量？**  
  A: 编辑 Worker.js 文件中的 `const batchSize = 3;`，调整为你需要的数字。

#### 适用场景说明
- 本 Worker 适用于常规表单登录、API 登录的网站。
- 不适用于需要极验、滑块、人机验证、短信验证码等二次验证的网站。

---

## 免责声明
本脚本仅供学习和个人自动化使用。请勿用于非法用途。

---

## License
This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.
