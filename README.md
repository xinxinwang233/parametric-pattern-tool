# 参数化服装纸样工具

一个根据身体数据实时生成、预览并导出经典女装上衣原型纸样的 React + Node.js 工具。

## 功能

- 调整背长、胸围、松量和袖长参数
- 实时生成衣身与袖子纸样
- 显示结构线、坐标点和缝份
- 导出 PDF、SVG、DXF 和 PLT
- 收集后续版型建议
- 记录匿名访问和下载统计

## 本地开发

先启动后端：

```bash
npm run dev:server
```

再在另一个终端启动前端：

```bash
npm run dev
```

## 生产运行

```bash
npm ci
npm run build
npm start
```

服务默认读取平台提供的 `PORT` 环境变量，运行数据保存在 `data/app-data.json`。生产部署时请为 `data` 目录配置持久化存储，并设置 `VISITOR_HASH_SALT` 环境变量。

## 后台统计与 IP 白名单

统计面板位于 `/admin`（`/stats` 是同一页面），统计接口为 `/api/stats`。这三个入口都受 IP 白名单保护。

编辑 `config/admin-access.json`：

```json
{
  "allowedIps": ["127.0.0.1", "::1", "你的固定公网 IP"],
  "trustedProxyIps": ["反向代理服务器 IP"]
}
```

- `allowedIps`：允许查看后台的客户端 IP，使用精确 IP，不填写网段。
- `trustedProxyIps`：只有请求直接来自这里列出的代理时，服务才会读取 `X-Forwarded-For`。没有反向代理时保持空数组。
- 配置会在每次后台请求时重新读取，修改后无需重启。
- 配置缺失、格式错误或白名单为空时，后台默认拒绝全部访问。
- 可用 `ADMIN_ACCESS_CONFIG` 环境变量指定部署环境中的其他配置文件路径。
