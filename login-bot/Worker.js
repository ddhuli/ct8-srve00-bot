// Cloudflare Worker 自动登录并推送 Telegram 消息
// 优化版，含详细中文注释和安全加固建议

// 监听 HTTP 请求（可用于健康检查）
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

// 监听定时触发事件（需在 Cloudflare 后台设置 Cron Trigger）
addEventListener('scheduled', event => {
  event.waitUntil(handleScheduled(event))
})

// 健康检查接口
async function handleRequest(request) {
  return new Response('Cloudflare Worker 正常运行')
}

// 定时任务主入口
// 需在 wrangler.toml 或 Worker 设置中绑定 KV 命名空间 LOGIN_BATCH_KV
// 例如：[[kv_namespaces]] binding = "LOGIN_BATCH_KV" id = "xxxxxx"
// 支持 0点归零批次与分批处理
async function handleScheduled(event) {
  // 判断是否为0点归零（Cloudflare Worker 采用 UTC 时间，0点即北京时间8点）
  const now = new Date(event.scheduledTime);
  if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0) {
    // 归零批次编号
    await LOGIN_BATCH_KV.put('batch_index', '0');
    await LOGIN_BATCH_KV.delete('last_finished_date'); // 新增：允许新一天重新开始
    try {
      const telegramConfig = JSON.parse(TELEGRAM_JSON);
      await sendTelegramMessage('【系统通知】已自动归零批次编号，准备新一天分批处理。', telegramConfig);
    } catch (e) {}
    return;
  }
  // 以下为分批处理逻辑
  let accounts, telegramConfig;
  try {
    accounts = JSON.parse(ACCOUNTS_JSON);
    telegramConfig = JSON.parse(TELEGRAM_JSON);
  } catch (e) {
    await sendTelegramMessage('【警告】环境变量配置错误，请检查 ACCOUNTS_JSON 和 TELEGRAM_JSON', null);
    return;
  }
  const batchSize = 3;
  const totalAccounts = accounts.length;
  let batchIndex = 0;
  try {
    const stored = await LOGIN_BATCH_KV.get('batch_index');
    batchIndex = stored ? parseInt(stored, 10) : 0;
    if (isNaN(batchIndex) || batchIndex < 0) batchIndex = 0;
  } catch (e) { batchIndex = 0; }

  // 新增：检查当天是否已全部处理完账号，避免重复登录
  const nowDate = new Date(event.scheduledTime);
  const todayStr = nowDate.toISOString().slice(0, 10); // 'YYYY-MM-DD'
  let lastFinishedDate = '';
  try {
    lastFinishedDate = await LOGIN_BATCH_KV.get('last_finished_date') || '';
  } catch (e) { lastFinishedDate = ''; }
  if (batchIndex === 0 && lastFinishedDate === todayStr) {
    // 今天已全部处理完，等待明天
    return;
  }

  const start = batchIndex * batchSize;
  const end = Math.min(start + batchSize, totalAccounts);
  const batchAccounts = accounts.slice(start, end);
  const results = await loginAccounts(batchAccounts, telegramConfig);
  await sendBatchSummary(results, telegramConfig, batchIndex, start, end, totalAccounts);
  if (end < totalAccounts) {
    await LOGIN_BATCH_KV.put('batch_index', String(batchIndex+1));
    const nextBatchMsg = `本批次已处理账号：${end}/${totalAccounts}，等待下次自动触发第${batchIndex+2}批。`;
    await sendTelegramMessage(nextBatchMsg, telegramConfig);
  } else {
    await sendTelegramMessage('全部账号已处理完成！下次将从头开始。', telegramConfig);
    await LOGIN_BATCH_KV.put('batch_index', '0');
    await LOGIN_BATCH_KV.put('last_finished_date', todayStr); // 记录今天已完成
  }
}


// 批次汇总推送
async function sendBatchSummary(results, telegramConfig, batchIndex, start, end, total) {
  const successfulLogins = results.filter(r => r.success);
  const failedLogins = results.filter(r => !r.success);
  let summaryMessage = `【第${batchIndex+1}批次：账号${start+1}~${end}/${total}】\n`;
  summaryMessage += `成功登录账号：${successfulLogins.length}\n`;
  summaryMessage += `登录失败账号：${failedLogins.length}\n`;
  if (failedLogins.length > 0) {
    summaryMessage += '\n失败账号列表：\n';
    failedLogins.forEach(({ username, type, message }) => {
      const safeUser = username.replace(/(.{2}).+(.{2})/, '$1****$2');
      summaryMessage += `- ${safeUser} (${type}): ${message}\n`;
    });
  }
  await sendTelegramMessage(summaryMessage, telegramConfig);
}


// 批量登录所有账号
async function loginAccounts(accounts, telegramConfig) {
  const results = []
  for (const account of accounts) {
    // 登录单个账号
    const result = await loginAccount(account, telegramConfig)
    results.push({ ...account, ...result })
    // 随机延迟，防止被目标网站封禁
    await delay(Math.floor(Math.random() * 8000) + 1000)
  }
  return results
}

// 生成随机 User-Agent，防止被识别为机器人
function generateRandomUserAgent() {
  const browsers = ['Chrome', 'Firefox', 'Safari', 'Edge', 'Opera']
  const browser = browsers[Math.floor(Math.random() * browsers.length)]
  const version = Math.floor(Math.random() * 100) + 1
  const os = ['Windows NT 10.0', 'Macintosh', 'X11']
  const selectedOS = os[Math.floor(Math.random() * os.length)]
  const osVersion = selectedOS === 'X11' ? 'Linux x86_64' : selectedOS === 'Macintosh' ? 'Intel Mac OS X 10_15_7' : 'Win64; x64'
  return `Mozilla/5.0 (${selectedOS}; ${osVersion}) AppleWebKit/537.36 (KHTML, like Gecko) ${browser}/${version}.0.0.0 Safari/537.36`
}

// 登录单个账号，异常和敏感信息处理加固
async function loginAccount(account, telegramConfig) {
  const { username, password, panelnum, type } = account
  // 根据账号类型拼接登录地址
  let url = type === 'ct8'
    ? 'https://panel.ct8.pl/login/?next=/'
    : `https://panel${panelnum}.serv00.com/login/?next=/`
  const userAgent = generateRandomUserAgent()
  try {
    // 1. 获取登录页面，提取 CSRF Token
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': userAgent },
    })
    const pageContent = await response.text()
    const csrfMatch = pageContent.match(/name="csrfmiddlewaretoken" value="([^"]*)"/)
    const csrfToken = csrfMatch ? csrfMatch[1] : null
    if (!csrfToken) throw new Error('CSRF token 未找到')
    // 2. 提取初始 Cookie
    const initialCookies = response.headers.get('set-cookie') || ''
    // 3. 构造登录表单
    const formData = new URLSearchParams({
      'username': username,
      'password': password,
      'csrfmiddlewaretoken': csrfToken,
      'next': '/'
    })
    // 4. 提交登录请求
    const loginResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': url,
        'User-Agent': userAgent,
        'Cookie': initialCookies,
      },
      body: formData.toString(),
      redirect: 'manual'
    })
    const loginResponseBody = await loginResponse.text()
    // 5. 判断登录结果
    if (loginResponse.status === 302 && loginResponse.headers.get('location') === '/') {
      // 登录成功，访问后台首页确认
      const loginCookies = loginResponse.headers.get('set-cookie') || ''
      const allCookies = combineCookies(initialCookies, loginCookies)
      const dashboardResponse = await fetch(url.replace('/login/', '/'), {
        headers: {
          'Cookie': allCookies,
          'User-Agent': userAgent,
        }
      })
      const dashboardContent = await dashboardResponse.text()
      if (dashboardContent.includes('href="/logout/"') || dashboardContent.includes('href="/wyloguj/"')) {
        // 登录成功，推送不含密码的账号信息
        const nowUtc = formatToISO(new Date())
        const nowBeijing = formatToISO(new Date(Date.now() + 8 * 60 * 60 * 1000))
        const safeUser = username.replace(/(.{2}).+(.{2})/, '$1****$2')
        const message = `账号 ${safeUser} (${type}) 于北京时间 ${nowBeijing}（UTC时间 ${nowUtc}）登录成功！`
        await sendTelegramMessage(message, telegramConfig)
        return { success: true, message }
      } else {
        const safeUser = username.replace(/(.{2}).+(.{2})/, '$1****$2')
        const message = `账号 ${safeUser} (${type}) 登录后未找到登出链接，可能登录失败。`
        await sendTelegramMessage(message, telegramConfig)
        return { success: false, message }
      }
    } else if (loginResponseBody.includes('Nieprawidłowy login lub hasło')) {
      const safeUser = username.replace(/(.{2}).+(.{2})/, '$1****$2')
      const message = `账号 ${safeUser} (${type}) 登录失败：用户名或密码错误。`
      await sendTelegramMessage(message, telegramConfig)
      return { success: false, message }
    } else {
      const safeUser = username.replace(/(.{2}).+(.{2})/, '$1****$2')
      const message = `账号 ${safeUser} (${type}) 登录失败，未知原因。请检查账号和密码是否正确。`
      await sendTelegramMessage(message, telegramConfig)
      return { success: false, message }
    }
  } catch (error) {
    const safeUser = username.replace(/(.{2}).+(.{2})/, '$1****$2')
    const message = `账号 ${safeUser} (${type}) 登录时出现错误: ${error.message}`
    await sendTelegramMessage(message, telegramConfig)
    return { success: false, message }
  }
}

// 合并 Cookie，防止覆盖
function combineCookies(cookies1, cookies2) {
  const cookieMap = new Map()
  // 支持多种分隔符
  const parseCookies = (cookieString) => {
    cookieString.split(/[,;]+/).forEach(cookie => {
      const [fullCookie] = cookie.trim().split(';')
      const [name, value] = fullCookie.split('=')
      if (name && value) {
        cookieMap.set(name.trim(), value.trim())
      }
    })
  }
  parseCookies(cookies1)
  parseCookies(cookies2)
  return Array.from(cookieMap.entries()).map(([name, value]) => `${name}=${value}`).join('; ')
}

// 汇总所有账号的登录结果并推送
async function sendSummary(results, telegramConfig) {
  const successfulLogins = results.filter(r => r.success)
  const failedLogins = results.filter(r => !r.success)
  let summaryMessage = '【登录结果统计】\n'
  summaryMessage += `成功登录账号：${successfulLogins.length}\n`
  summaryMessage += `登录失败账号：${failedLogins.length}\n`
  if (failedLogins.length > 0) {
    summaryMessage += '\n失败账号列表：\n'
    failedLogins.forEach(({ username, type, message }) => {
      const safeUser = username.replace(/(.{2}).+(.{2})/, '$1****$2')
      summaryMessage += `- ${safeUser} (${type}): ${message}\n`
    })
  }
  await sendTelegramMessage(summaryMessage, telegramConfig)
}

// 向 Telegram 发送消息，异常自动捕获
async function sendTelegramMessage(message, telegramConfig) {
  // telegramConfig 为空时不发送
  if (!telegramConfig) return
  const { telegramBotToken, telegramBotUserId } = telegramConfig
  if (!telegramBotToken || !telegramBotUserId) return
  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramBotUserId,
        text: message
      })
    })
  } catch (error) {
    // 只在后台日志记录，不推送错误详情
    console.error('Telegram 消息发送失败:', error)
  }
}

// 格式化时间为 ISO 字符串（去掉 T/Z）
function formatToISO(date) {
  return date.toISOString().replace('T', ' ').replace(/\.?\d*Z$/, '')
}

// 延迟函数
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
