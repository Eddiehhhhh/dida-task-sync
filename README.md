# 新枝 → Get笔记 自动同步

自动检查新枝中的小红书链接，并同步到 Get笔记 进行解析。

## 功能

- 🔍 每 5 分钟自动检查新枝笔记
- 🔴 筛选小红书链接
- 📝 调用 Get笔记 API 保存并解析内容
- 🗑️ 自动删除新枝中的已处理记录
- 🔒 使用 GitHub Secrets 安全存储 Token

## 使用方法

### 1. Fork 本仓库

### 2. 添加 Secrets

在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 中添加：

| Secret Name | 说明 | 获取方式 |
|-------------|------|---------|
| `XINZHI_TOKEN` | 新枝 CLI AccessToken | 新枝 App → CLI Beta → 复制 AccessToken |
| `GETNOTE_API_KEY` | Get笔记 API Key | Get笔记配置中获取 |

### 3. 启用 Actions

在 GitHub 仓库的 `Actions` 页面启用工作流。

### 4. 完成！

现在你可以：
- 在微信中向新枝小助手转发小红书链接
- 等待最多 5 分钟，自动同步到 Get笔记
- 在 Get笔记 中查看解析后的内容

## 本地测试

```bash
# 安装依赖
npm install

# 运行
XINZHI_TOKEN=your_token GETNOTE_API_KEY=your_key node sync.js
```

## 隐私说明

- 本仓库为公开仓库，但所有敏感信息（Token、API Key）都存储在 GitHub Secrets 中
- 运行日志中不会输出任何敏感信息
- `processed_ids.json` 记录已处理的笔记 ID，用于去重

## License

MIT
