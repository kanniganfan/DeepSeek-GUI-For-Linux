<p align="center">
  <img src="src/asset/img/deepseek.png" width="96" alt="DeepSeek GUI Icon">
</p>

# DeepSeek GUI for Linux

English | [简体中文](./README.md)

> This repository is the **Linux packaging build** of [DeepSeek GUI](https://github.com/XingYu-Zhong/DeepSeek-GUI), maintained by [KANNI](https://github.com/kanniganfan). All feature development credits go to the original authors.

[![GitHub release](https://img.shields.io/github/v/release/kanniganfan/DeepSeek-GUI-For-Linux?label=Download)](https://github.com/kanniganfan/DeepSeek-GUI-For-Linux/releases)
[![License](https://img.shields.io/github/license/kanniganfan/DeepSeek-GUI-For-Linux)](./LICENSE)

---

## About

[DeepSeek GUI](https://github.com/XingYu-Zhong/DeepSeek-GUI) is a local desktop workspace for developers and power AI users, built on the Kun runtime with Code, Write, and more modes.

The original project primarily ships macOS and Windows builds. This repository provides **Linux builds** in AppImage, deb, and rpm formats, covering both x86_64 and arm64 architectures.

**This repository does not participate in feature development — it only handles Linux packaging and releases.**

## Download

Head to the [Releases](https://github.com/kanniganfan/DeepSeek-GUI-For-Linux/releases) page to grab the build for your system:

| Format | x86_64 | arm64 |
|--------|--------|-------|
| AppImage | ✅ | ✅ |
| deb (Ubuntu/Debian) | ✅ | ✅ |
| rpm (Fedora/RHEL) | ✅ | ✅ |

### Installation

**AppImage (universal):**
```bash
chmod +x DeepSeek-GUI-*.AppImage
./DeepSeek-GUI-*.AppImage
```

**deb (Ubuntu/Debian):**
```bash
sudo dpkg -i DeepSeek-GUI-*.deb
```

**rpm (Fedora/RHEL):**
```bash
sudo rpm -i DeepSeek-GUI-*.rpm
```

## Version Sync

This repository mirrors the original project's version numbers. When a new version is released upstream, the Linux build here will be updated accordingly.

## Original Project

- Original repo: https://github.com/XingYu-Zhong/DeepSeek-GUI
- Feature requests and bug reports should be filed on the original project
- Linux packaging issues can be filed here

## License

Same as the original project: [MIT License](./LICENSE).

---

<p align="center">
  <a href="https://star-history.com/#kanniganfan/DeepSeek-GUI-For-Linux&Date">
    <img src="https://api.star-history.com/chart?repos=kanniganfan/DeepSeek-GUI-For-Linux&type=date&legend=top-left" alt="Star History Chart" width="600">
  </a>
</p>
