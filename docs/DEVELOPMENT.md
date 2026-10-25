# 开发与构建

## 目录

- extension/：Chrome MV3、浮球、网页段落、站点适配和独立阅读页。
- engine/：回环服务、队列、OCR、擦字排版、文本服务和费用记录。
- scripts/、tests/：构建、隔离示例和确定性检查。
- resources/model-manifest.json：固定模型 URL、大小和 SHA-256；权重不进 Git。
- docs/images/：不含用户数据的界面截图。
- models/、.venv/、node_modules/：本地模型和开发依赖，忽略上传。
- .local/、build/：可再生成的测试与构建目录。
- dist/release-0.1.1/：最新发布物；dist/github-upload/：可上传的纯源码副本，均不进 Git。

## 检查

需要 Windows x64、Python 3.12、uv 和 Node.js。

```powershell
uv sync --locked
npm ci
npm run typecheck
npm test
uv run pytest -q
npm run build
```

这些检查使用生成或模拟数据，不读取用户 Key，不调用收费模型。可选浏览器检查需要 Playwright 的 Chromium：

```powershell
npx playwright install chromium
node scripts/floating_controls_smoke.mjs
```

可通过 MWT_BROWSER 指定测试浏览器。所有浏览器检查只创建独立 profile，不控制日常 Chrome。

## 打包

```powershell
uv run python -m scripts.prepare_models
uv run python -m scripts.package
uv run python -m scripts.verify_release
```

prepare_models 根据固定清单验证已有文件或下载到临时文件，SHA-256 通过后才采用。package 自动构建本机启动器与安装器，按白名单生成源码包；临时可执行文件和规格只写入 build/。已有匹配引擎时可用 --skip-exe --reuse-engine 复用最新发布包。

兼容性修补在 scripts/patch_runtime.py 中明确记录，只处理构建副本中的 Manga OCR tokenizer 和生成接口。第三方许可随运行时保留。扩展公开密钥 extension/public-key.txt 决定扩展 ID，不含私钥；不要随意更换。

截图可重现：

```powershell
uv run python -m scripts.docs_samples
node scripts/docs_screenshots.mjs
```

它们使用原创气泡与本地演示文本、模拟连接，不调用模型。生产扩展重新由 npm run build 构建，不能复制 .local/ 中的测试扩展作发布物。

## 实现约束

两个管线线程共享本地图像处理锁，文本 API 最多两个在途。任务、请求收据及预算由 SQLite 事务保存；浏览器后台重启不拥有唯一任务状态。重复内容使用识别／文字／绘图缓存，方向编辑不单独请求模型。

Native Messaging 只传启动与回环连接信息；服务绑定127.0.0.1并校验令牌、Host、Origin。网页内容只能作为待译数据，不能执行。模型 Key 使用 Windows 凭据管理器，源文件与同步配置不存 Key。未来 Safari 需另做宿主，不复用 Windows 引擎。

## 提交前

先执行检查、敏感信息扫描和源码白名单打包。不要提交应用数据、浏览器 profile、模型权重、运行环境或安装包。发布步骤见[RELEASE.md](RELEASE.md)。
