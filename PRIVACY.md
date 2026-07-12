# 隐私说明 / Privacy Policy

## 数据收集 / Data Collection

Video to Markdown 插件**不收集、不存储、不上传**任何用户数据到产品自有服务器。

本插件：
- 不会追踪浏览历史或视频观看记录
- 不会收集字幕内容、生成的 Markdown 或模型配置信息
- 不使用任何分析或追踪 SDK

## 数据传输 / Data Transmission

字幕文本通过用户自行配置的 API Key，直接发送至用户选择的模型服务商（如 OpenAI 兼容 API）。该行为受用户所选服务商的条款和隐私政策约束。

插件开发者无法访问用户的 API Key、字幕内容或模型返回结果。

## 本地存储 / Local Storage

以下信息存储在浏览器本地（`chrome.storage.local`）：
- 模型配置（API Key、Base URL、模型名称）
- 界面偏好（字幕轨道、处理模式、时间戳开关）

所有数据仅存储在用户设备上，不会同步到云端。

## 权限使用 / Permission Usage

| 权限 | 用途 |
|------|------|
| `sidePanel` | 在 YouTube/B 站页面显示侧边栏 |
| `storage` | 本地存储用户配置和偏好 |
| `downloads` | 将生成的 Markdown 保存为文件 |
| 页面访问 | 读取视频页面上的元数据和字幕信息 |
| 模型 API（可选） | 仅在用户配置后请求授权 |

## 联系 / Contact

如有隐私相关问题，请通过 GitHub Issues 联系。
