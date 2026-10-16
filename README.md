# 续舟 Xuzhou · 2.3.1-beta.1

在同一段聊天里选择 Codex、Kiro V3 或 ZCode，带着可见前文继续工作。续舟维护软件与模型选择、接续位置、历史检索和同步回执；底层复用 AionUi / AionCore，保留 Apache-2.0、原作者及第三方声明。

本目录是 Windows x64 公开测试版的发行材料。上传状态与验收范围以随附发行报告为准。安装包没有 Windows 代码签名，当前采用手动更新。

## 安装与聊天保护

1. 核对 SHA256SUMS.txt，运行 Xuzhou-2.3.1-beta.1-win-x64-setup.exe。
2. 从“续舟测试版”快捷方式启动。Beta 默认安装到 Programs/XuzhouBeta，聊天保存在独立的 AppData/Roaming/XuzhouBeta 目录。
3. Codex、Kiro V3、ZCode 需要自行安装并登录，续舟不附带账号、订阅或服务额度。
4. 左侧“控制中心”可查看实验功能提示、连接、备份和更新设置。

Beta 不自动接管原版聊天目录、旧工作台配置、快捷方式或 aionui 链接。原版可继续使用。Codex 本地项目列表读取本机原生记录；打开聊天与同步属于后续用户操作。参见 [聊天保护说明](docs/UPGRADE.md)。

## 验证与限制

文字接续与指定同步场景已有真实客户端验证。ZCode 原生双向同步、Grok 共享上下文、音频、真实云机、实体手机、真实外置盘恢复、夸克备份及自动更新仍有未接通或未验收部分。

[完整功能范围](docs/FEATURES.md) · [清洁环境边界](docs/CLEAN-TEST.md) · [发布步骤](docs/PUBLISH.md)。构建步骤见 REBUILD.md；最终运行、安装升级、许可和隐私证据见发行目录 verification/。

## 隐私与开源

[隐私说明](PRIVACY.md) · [安全说明](SECURITY.md) · [Apache-2.0](LICENSE) · [原作者与来源](NOTICE)

聊天正文没有应用级全文加密，实验备份的加密不等于聊天数据库已加密。发布只使用干净源码和核验过的附件，不上传私人开发目录。
