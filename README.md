<p align="center">
  <img src="src/asset/img/deepseek.png" width="96" alt="DeepSeek GUI 图标">
</p>

# DeepSeek GUI for Linux

[English](./README.en.md) | 简体中文

> 本仓库是 [DeepSeek GUI](https://github.com/XingYu-Zhong/DeepSeek-GUI) 的 **Linux 打包版本**，由 [KANNI](https://github.com/kanniganfan) 负责构建和发布，功能开发归原作者所有。

[![GitHub release](https://img.shields.io/github/v/release/kanniganfan/DeepSeek-GUI-For-Linux?label=下载)](https://github.com/kanniganfan/DeepSeek-GUI-For-Linux/releases)
[![License](https://img.shields.io/github/license/kanniganfan/DeepSeek-GUI-For-Linux)](./LICENSE)

---

## 关于

[DeepSeek GUI](https://github.com/XingYu-Zhong/DeepSeek-GUI) 是一个面向开发者和高频 AI 工作者的本地桌面工作台，基于 Kun 运行时，支持 Code、Write 等模式。

原项目主要提供 macOS 和 Windows 版本。本仓库专门为其构建 **Linux 版本**，提供 AppImage、deb、rpm 三种格式，覆盖 x86_64 和 arm64 架构。

**本仓库不参与功能开发，仅负责 Linux 平台的打包和发布。**

## 下载

前往 [Releases](https://github.com/kanniganfan/DeepSeek-GUI-For-Linux/releases) 页面下载适合你系统的版本：

| 格式 | x86_64 | arm64 |
|------|--------|-------|
| AppImage | ✅ | ✅ |
| deb (Ubuntu/Debian) | ✅ | ✅ |
| rpm (Fedora/RHEL) | ✅ | ✅ |

### 安装方式

**AppImage（通用）：**
```bash
chmod +x DeepSeek-GUI-*.AppImage
./DeepSeek-GUI-*.AppImage
```

**deb（Ubuntu/Debian）：**
```bash
sudo dpkg -i DeepSeek-GUI-*.deb
```

**rpm（Fedora/RHEL）：**
```bash
sudo rpm -i DeepSeek-GUI-*.rpm
```

## 版本同步

本仓库版本号与原项目保持一致。当原项目发布新版本后，本仓库会跟进构建对应的 Linux 版本。

## 原项目

- 原项目地址：https://github.com/XingYu-Zhong/DeepSeek-GUI
- 功能问题、Bug 反馈请提交至原项目
- Linux 打包相关问题可提交至本仓库

## 许可证

与原项目一致，采用 [MIT License](./LICENSE)。

---

<p align="center">
  <a href="https://star-history.com/#kanniganfan/DeepSeek-GUI-For-Linux&Date">
    <img src="https://api.star-history.com/chart?repos=kanniganfan/DeepSeek-GUI-For-Linux&type=date&legend=top-left" alt="Star History Chart" width="600">
  </a>
</p>
