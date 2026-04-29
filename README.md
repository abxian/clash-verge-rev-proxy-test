# 神仙云 Windows 客户端

这是神仙云桌面客户端，基于 Clash Verge Rev / Tauri 2 / Mihomo 改造。目标是把原本复杂的 Clash 客户端改成小白可用的一页式代理工具。

## 当前功能

- 提取码订阅
  - 用户只需要输入后台生成的提取码。
  - 客户端请求 `https://sub.jc116.com/api/verify/<code>` 获取订阅地址。
  - 导入后保存提取码、订阅名称、过期时间、更新版本。
  - 切换提取码时会删除旧订阅信息。
- 一键连接
  - 首页保留大按钮启动/停止代理。
  - 支持规则模式和全局模式。
  - 保留代理页面，用于选择策略组和节点。
  - 支持系统代理和 TUN 虚拟网卡模式。
- 节点和订阅
  - 自动导入后台返回的订阅。
  - 支持节点延迟测试。
  - 支持后台推送订阅更新，客户端定时检查更新版本。
  - `sub.jc116.com` 被写入直连规则，避免客户端连接后台时走代理导致失败。
- 客户端在线统计
  - 开启代理后向后台上报在线。
  - 停止代理后向后台上报离线。
  - 后台可看到设备类型、IP、版本、提取码。
- 深度链接
  - 支持 `shenxianyun://install-config?url=<订阅地址>&name=<名称>`。
  - 也保留 `clash://`、`clash-verge://` 兼容协议。
- UI 改造
  - 默认固定窗口，简化导航。
  - 首页是神仙云的一页式操作面板。
  - 去掉大量原 Clash Verge 的复杂入口。

## 目录结构

```text
clash-verge-rev/
  src/                         # React 前端
    pages/home.tsx             # 神仙云首页主逻辑
    pages/proxies.tsx          # 代理/节点页面
  src-tauri/                   # Tauri + Rust 后端
    tauri.conf.json            # Tauri 配置、协议、图标
    tauri.windows.conf.json    # Windows 特定配置
    src/
      utils/resolve/scheme.rs  # shenxianyun:// 深度链接导入
      config/config.rs         # Mihomo 配置增强和直连规则
      core/tray/               # 托盘菜单
  package.json                 # pnpm 脚本和前端依赖
```

## 环境要求

Windows 本地编译推荐：

- Windows 10/11 x64
- Node.js 24.x
- pnpm 10.x
- Rust 1.91 或更高
- Visual Studio 2022 Build Tools
  - Desktop development with C++
  - MSVC
  - Windows SDK
- WebView2 Runtime
- Git

检查环境：

```powershell
node -v
pnpm -v
rustc -V
cargo -V
```

## 初始化依赖

```powershell
cd C:\Users\fucku\Desktop\vpn\clash-verge-rev
pnpm install
```

如果首次构建缺少 Rust target：

```powershell
rustup target add x86_64-pc-windows-msvc
```

## 本地开发运行

```powershell
pnpm dev
```

开发模式会打开 Tauri 窗口，前端由 Vite 提供。

## 本地打包 Windows 安装包

```powershell
pnpm build --target x86_64-pc-windows-msvc
```

常见产物路径：

```text
target/release/bundle/nsis/神仙云_2.4.8_x64-setup.exe
target/release/shenxianyun.exe
```

如果只想检查前端类型和构建：

```powershell
pnpm web:build
```

## GitHub Actions 编译

仓库可使用 Windows runner 编译 Windows 安装包。推荐工作流：

1. checkout
2. setup Node 24
3. setup pnpm
4. setup Rust stable
5. `pnpm install`
6. `pnpm build --target x86_64-pc-windows-msvc`
7. 上传 `target/release/bundle/nsis/*.exe`

注意：私有仓库 Actions 受 GitHub 账号计费限制影响。如果提示 billing 或 spending limit，需要到 GitHub Billing 页面处理，或者本地编译。

## 后台接口

默认后台地址在 `src/pages/home.tsx`：

```ts
const SUBSCRIPTION_BASE_URL = 'https://sub.jc116.com'
```

客户端使用的接口：

```text
GET /api/verify/<code>
GET /api/update-state/<code>
GET /api/client/heartbeat/<code>
GET /api/client/offline/<code>
GET /sub/<code>
```

手动导入提取码时会带：

```text
?import=1&client_id=<客户端ID>
```

后台据此只记录一次首次导入次数。

## 常见修改点

- 改后台域名：`src/pages/home.tsx` 的 `SUBSCRIPTION_BASE_URL`。
- 改应用名称和版本：`package.json`、`src-tauri/tauri.conf.json`。
- 改窗口大小：`src-tauri/src/utils/resolve/window.rs`。
- 改首页 UI：`src/pages/home.tsx`。
- 改代理页面 UI：`src/pages/proxies.tsx`。
- 改深度链接导入：`src-tauri/src/utils/resolve/scheme.rs`。
- 改托盘菜单：`src-tauri/src/core/tray/`。
- 改直连规则：`src-tauri/src/config/config.rs`。

## 发布前检查

```powershell
pnpm web:build
pnpm build --target x86_64-pc-windows-msvc
```

打包后安装一次，检查：

- 首次输入提取码可导入订阅。
- 点击启动后系统代理状态正确。
- 规则/全局模式可切换。
- 代理页面能选择节点。
- 后台能看到在线客户端。
- 停止后后台状态变离线。
- 网页 `一键导入神仙云` 能打开客户端。

## 数据和配置位置

当前项目已把应用目录和管道名改成神仙云相关名称，避免和原 Clash Verge 共用配置目录。

如需要清理本地配置，可检查 Windows 用户目录下的应用数据目录。删除前先备份用户订阅和设置。
