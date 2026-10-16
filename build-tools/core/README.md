# AionCore 发行源代码候选

当前官方 v0.2.2 的内置 PDF 技能禁止再分发，并确实编入当前 aioncore.exe。不能只删除运行时解压的 PDF 目录，也不能改一下声明就发布原二进制。

`prepare.ps1` 在独立审查目录准备源码候选：从固定提交复制源码时排除整个受限 PDF 目录，加入独立编写的 `pdf-SKILL.md`，保留根 Apache-2.0 LICENSE 和其他声明，将矛盾的工作区 MIT 元数据对齐至根许可。原源码、已安装二进制和聊天数据完全不改。

本次仅准备源码候选。没有 Rust / Windows MSVC 编译工具，未编译、未启用，不声称已经获得可发布二进制或 PDF 功能等价验证。

后续构建环境按该标签上游 release.yml 固定 Rust 1.95.0 和 Windows x86_64-pc-windows-msvc，使用 Windows C++ 工具链。在候选目录执行 `cargo build --release --locked --target x86_64-pc-windows-msvc -p aionui-app`，并沿用上游 Windows 的 `-C target-feature=+crt-static`。保留实际编译日志、依赖解析结果和输出校验值。

构建后检查二进制中不含禁止分发材料，核对导出的 builtin-skills/pdf 只有新内容。使用隔离测试资料验证启动、旧会话读取、模型切换、自动同步、长历史检索和 PDF 处理，再把该具体二进制加入发行审查。现有用户资料不能作为发行附件。

此外须按最终安装包逐个审查 managed-resources、Hub 扩展归档及原生库，包含续舟的桥接实现；源码清理不自动解决这些组件的许可。最终产物的审查与本机继续使用是两个独立状态。
