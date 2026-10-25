# 上传与维护发布

源码提交到 main，安装包和引擎单独通过 Release 分发。当前仓库保持 private；后续公开需要另行确认。不要将 GitHub Token 写入插件、下载地址或发布包。

## 源码

运行 `python -m scripts.prepare_upload`，使用统一白名单生成 dist/github-upload/。这个目录可直接上传；也可使用最新 Release 目录中的 manga-web-translator-0.1.1-source.zip。里面只有源码、测试、锁文件、小型资源清单、截图、说明和许可证。

原项目可作为本地 Git 工作目录，但只应提交白名单文件；models/、.venv/、node_modules/、.local/、build/、dist/ 和用户数据都被忽略。先完成秘密扫描，再创建远端仓库并确认可见性。不要上传整个本地工作目录。

## Release 附件

从 dist/release-0.1.1/ 选择：

- chrome-extension-0.1.1.zip
- mwt-setup-0.1.1.exe
- engine.zip（首次安装完整引擎）
- runtime-update.zip（已有引擎的升级包）
- release.json、SHA256SUMS.txt
- manga-web-translator-0.1.1-source.zip
- README.md、LICENSE、THIRD_PARTY.md（与校验清单对应）

安装包、引擎不进 Git 历史，另上传 Release。[GitHub 官方说明](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)当前要求单个Release附件小于2 GiB；本引擎约1.6 GiB。

发布后检查四件事：源码与附件无Key／令牌／任务数据库；版本和校验文件匹配；README图片可打开；新用户照安装说明可找到所需附件。未做的真实平台验收不能写成已经支持。
