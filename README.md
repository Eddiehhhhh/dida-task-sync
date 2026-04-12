# 新枝 → Get笔记 自动同步

自动检查新枝中的小红书链接，并同步到 Get笔记 进行解析。

## 功能

- 🔍 **智能时间过滤**：只检查最近 24 小时内创建的笔记，而不是前 N 条
- 🔴 筛选小红书链接（xiaohongshu.com / xhslink.com）
- 📝 调用 Get笔记 API 保存并解析内容
- 🗑️ 自动归档新枝中的已处理记录
- 🔒 使用 GitHub Secrets 安全存储 Token
- 📊 详细的运行日志

## 触发方式

### 1. GitHub Schedule（自动）
每 5 分钟自动运行一次。GitHub Actions 的定时任务可能有延迟，如果需要更可靠的触发，请使用外部 cron。

### 2. 手动触发
在 GitHub Actions 页面手动点击 "Run workflow"。

### 3. 外部 Cron 触发（推荐）
使用 cron-job.org 等服务，每 5 分钟触发一次：

```
POST https://api.github.com/repos/Eddiehhhhh/xinzhi-to-getnote/dispatches
Headers:
  Authorization: Bearer <你的 GitHub PAT>
  Accept: application/vnd.github.v3+json
Body:
  {"event_type": "sync"}
```

## 使用方法

### 1. Fork 本仓库

### 2. 添加 Secrets

在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 中添加：

| Secret Name | 说明 | 获取方式 |
|-------------|------|---------|
| `XINZHI_TOKEN` | 新枝 CLI AccessToken | 新枝 App → CLI Beta → 复制 AccessToken |
| `GETNOTE_API_KEY` | Get笔记 API Key | Get笔记配置中获取 |
| `GETNOTE_CLIENT_ID` | Get笔记 Client ID | Get笔记配置中获取（可选） |

### 3. 启用 Actions

在 GitHub 仓库的 `Actions` 页面启用工作流。

### 4. 完成！

现在你可以：
- 在微信中向新枝小助手转发小红书链接
- 等待自动同步到 Get笔记
- 在 Get笔记 中查看解析后的内容

## 本地测试

```bash
# 安装依赖
npm install

# 运行
XINZHI_TOKEN=your_token GETNOTE_API_KEY=your_key node sync.js
```

## 工作原理

1. 从新枝 API 获取最近 24 小时内创建的所有笔记
2. 筛选包含 `xiaohongshu.com` 或 `xhslink.com` 链接的笔记
3. 过滤掉已处理的笔记（使用 `processed_ids.json` 去重）
4. 对每个新笔记：
   - 调用 Get笔记 API 保存链接
   - 轮询任务进度，等待内容解析
   - 归档新枝记录
5. 更新 `processed_ids.json` 并提交

## 隐私说明

- 本仓库为公开仓库，但所有敏感信息（Token、API Key）都存储在 GitHub Secrets 中
- 运行日志中不会输出任何敏感信息
- `processed_ids.json` 记录已处理的笔记 ID，用于去重

## License

MIT
