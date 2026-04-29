# 神仙云 Windows 客户端开发文档

本文档用于 `vpnwindows` 仓库后续开发维护。这个项目基于 Clash Verge Rev 改造，技术栈是 React + Tauri 2 + Rust + Mihomo。

## 1. 项目定位

Windows 客户端目标是给用户一个小白化代理工具：

- 用户输入提取码。
- 客户端自动向 web 后台验证。
- 自动导入订阅。
- 一键启动/停止代理。
- 保留代理页面给高级用户选择节点。
- 后台可看到在线设备。
- 后台可推送订阅更新。

默认后台：

```text
https://sub.jc116.com
```

## 2. 仓库和分支

远端：

```text
https://github.com/abxian/vpnwindows.git
```

当前主要开发分支：

```text
dev
```

`main` 分支也有 README，但功能开发以 `dev` 为准。

## 3. 目录结构

```text
clash-verge-rev/
  README.md
  DEVELOPMENT.md
  package.json
  pnpm-lock.yaml
  src/
    pages/
      home.tsx                # 神仙云首页，提取码、启动按钮、更新、心跳
      proxies.tsx             # 代理/节点选择页面
      _layout.tsx             # 页面布局和路由
    services/                 # Tauri invoke 封装
    hooks/
    components/
  src-tauri/
    tauri.conf.json           # 应用名称、版本、协议、资源
    tauri.windows.conf.json   # Windows 窗口配置
    Cargo.toml
    src/
      lib.rs
      utils/
        resolve/
          window.rs           # 默认窗口大小、是否可调整
          scheme.rs           # shenxianyun:// 深度链接导入
        dirs.rs               # 应用目录、日志目录、管道名
      config/
        config.rs             # Mihomo 配置增强、直连规则
      core/
        tray/                 # 托盘菜单
        manager/              # 内核生命周期
  src-tauri/icons/            # 应用图标
```

## 4. 环境要求

推荐：

- Windows 10/11 x64
- Node.js 24.x
- pnpm 10.x
- Rust 1.91+
- Visual Studio 2022 Build Tools
  - Desktop development with C++
  - MSVC
  - Windows SDK
- WebView2 Runtime
- Git

检查：

```powershell
node -v
pnpm -v
rustc -V
cargo -V
```

首次安装依赖：

```powershell
cd C:\Users\fucku\Desktop\vpn\clash-verge-rev
pnpm install
rustup target add x86_64-pc-windows-msvc
```

## 5. 本地运行

```powershell
pnpm dev
```

开发模式会启动 Vite 和 Tauri 窗口。若窗口打不开，先检查：

- WebView2 是否安装。
- Rust 是否能编译。
- 端口是否被占用。
- Mihomo sidecar 是否存在。

## 6. 本地打包

Windows x64：

```powershell
pnpm build --target x86_64-pc-windows-msvc
```

常见产物：

```text
target/release/shenxianyun.exe
target/release/bundle/nsis/神仙云_2.4.8_x64-setup.exe
```

只检查前端：

```powershell
pnpm web:build
pnpm typecheck
```

Rust 检查：

```powershell
cargo clippy --all-targets --all-features -- -D warnings
```

## 7. 核心业务流程

### 7.1 输入提取码

入口：

```text
src/pages/home.tsx
```

核心函数：

- `verifyCode(input)`
- `activateCode(value)`
- `importByCode()`

流程：

1. 用户输入提取码。
2. 请求：

```text
GET https://sub.jc116.com/api/verify/<code>?import=1&client_id=<client-id>
```

3. 后台返回订阅 URL、过期时间、更新版本。
4. 调用 `importProfile()` 导入订阅。
5. 删除旧订阅，只保留当前提取码订阅。
6. 保存到 `localStorage`：

```text
CODE_STORAGE_KEY
CODE_NAME_STORAGE_KEY
CODE_EXPIRES_STORAGE_KEY
CODE_UPDATE_VERSION_STORAGE_KEY
CLIENT_ID_STORAGE_KEY
```

### 7.2 启动/停止代理

首页大按钮根据状态调用原 Clash Verge 的系统代理/TUN 能力。

状态来源：

- `enable_tun_mode`
- 系统代理状态
- profiles/current

过期判断：

- 如果本地保存 `expires_at`，超过后不允许启动。
- 如果断网，仍按本地过期时间判断，不因为连不上后台就禁用未过期用户。

### 7.3 订阅更新

客户端定时请求：

```text
GET /api/update-state/<code>
```

如果 `update_version` 大于本地保存值，则重新导入订阅。

后台按钮推送更新本质是更新时间戳，客户端轮询后发现变化。

### 7.4 在线统计

启动代理后：

```text
GET /api/client/heartbeat/<code>?client_id=...&platform=Windows电脑...
```

停止代理后：

```text
GET /api/client/offline/<code>?client_id=...
```

后台在线页按 `client_id` 展示。

### 7.5 深度链接

支持：

```text
shenxianyun://install-config?url=<encoded-url>&name=<encoded-name>
clash://install-config?url=<encoded-url>&name=<encoded-name>
clash-verge://install-config?url=<encoded-url>&name=<encoded-name>
```

处理代码：

```text
src-tauri/src/utils/resolve/scheme.rs
```

网页“一键导入神仙云”使用 `shenxianyun://`。

## 8. 关键文件说明

### `src/pages/home.tsx`

最重要的业务文件。包含：

- 后台地址 `SUBSCRIPTION_BASE_URL`
- 客户端 UA
- 提取码输入和保存
- 订阅导入
- 过期时间判断
- 更新订阅
- 上报在线/离线
- 首页 UI

改后台域名优先改这里：

```ts
const SUBSCRIPTION_BASE_URL = 'https://sub.jc116.com'
```

### `src/pages/proxies.tsx`

代理页和策略组选择。后续美化或改节点展示主要在这里。

### `src-tauri/src/utils/resolve/window.rs`

窗口尺寸、是否可缩放、是否显示系统标题栏。

### `src-tauri/src/config/config.rs`

Mihomo 配置增强。这里要保证：

- `sub.jc116.com` 直连。
- 规则模式和全局模式可用。
- 不引入重复 rule-set。

### `src-tauri/src/core/tray/`

托盘菜单。当前要求只保留必要选项，比如系统代理、TUN、代理、退出。

### `src-tauri/src/utils/dirs.rs`

应用目录和管道名。避免和原 Clash Verge 共用目录。

## 9. GitHub Actions

Windows 编译流程一般是：

1. checkout
2. setup Node 24
3. setup pnpm
4. setup Rust
5. install dependencies
6. `pnpm build --target x86_64-pc-windows-msvc`
7. 上传 NSIS installer

私有仓库 Actions 受 GitHub Billing 影响。出现 billing/spending limit 错误时，本地编译不受影响。

## 10. 常见问题

### 10.1 系统代理显示不一致

检查：

- 系统代理实际状态
- Verge 配置状态
- TUN 是否开启
- 首页 `actualRunning` 计算逻辑

### 10.2 TUN 不可用

Windows 需要管理员权限或服务安装。检查：

- 服务是否安装。
- 是否管理员启动。
- 托盘 TUN 菜单状态。

### 10.3 网页一键导入打不开客户端

检查：

- 是否安装过客户端。
- Windows 注册表是否注册了 `shenxianyun://`。
- `src-tauri/tauri.conf.json` deep-link schemes 是否包含 `shenxianyun`。
- 安装包是否重新安装。

### 10.4 修改后界面还是旧的

可能运行的是安装版，不是开发版。确认：

- `pnpm dev` 是否打开新窗口。
- 是否重新打包安装。
- Windows 是否有旧进程未退出。

## 11. 发布前检查

1. 输入提取码可导入。
2. 后台提取次数首次增加一次。
3. 重复导入同一提取码同一设备不重复增加。
4. 规则/全局模式可切换。
5. 节点选择生效。
6. 系统代理启动/停止状态正确。
7. TUN 开关状态正确。
8. 后台在线客户端能看到 Windows 设备。
9. 网页一键导入神仙云能打开客户端。
10. 打包安装后应用名、图标、配置目录正确。

## 12. Git 提交规则

每次修改后必须提交并推送：

```powershell
git status --short
git add <files>
git commit -m "type: message"
git push vpnwindows dev
```

如果要同步到 GitHub `main`：

```powershell
git push vpnwindows dev:main
```

提交前建议跑：

```powershell
pnpm typecheck
```

大型功能再跑：

```powershell
pnpm build --target x86_64-pc-windows-msvc
```

不要提交：

- `node_modules/`
- `target/`
- 本地安装包
- 私钥或证书
- 临时测试文件

