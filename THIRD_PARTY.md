# 第三方组件

本项目整体采用 GPL-3.0，与本地集成的 Comic Text Detector 许可一致。

| 组件 | 用途 | 上游与许可 |
| --- | --- | --- |
| Comic Text Detector（随 mokuro 0.2.5） | 检测与蒙版 | https://github.com/dmMaze/comic-text-detector · GPL-3.0 |
| Manga OCR 0.1.16 / manga-ocr-base | 日文识别 | https://github.com/kha-white/manga-ocr · Apache-2.0 |
| RapidOCR ONNX Runtime | 普通图片识别 | https://github.com/RapidAI/RapidOCR · Apache-2.0 |
| LaMa / simple-lama-inpainting 模型发行 | 本地修补 | https://github.com/advimman/lama / https://github.com/enesmsahin/simple-lama-inpainting · Apache-2.0 |
| PyTorch / torchvision | CPU 推理 | https://pytorch.org/ · BSD 风格许可 |
| CPython | 便携运行时 | https://python.org/ · PSF |

模型的固定下载地址、版本、大小和 SHA-256 见 resources/model-manifest.json（构建后同步至 models/manifest.json）。运行时包含各 Python 分发包的 dist-info 许可证、CTD LICENSE 及本项目源码。中文字体使用系统自带字体，不重新分发 Windows 字体。

Manga-Translator-Extension、Kites、Libre Manga Translator 仅作为公开设计参考，没有复制其扩展实现。

Manga OCR 的 tokenizer／生成接口兼容修补由 scripts/patch_runtime.py 明确实现，保留其 Apache-2.0 许可。README截图使用原创演示素材和独立浏览器界面，不包含第三方漫画页或用户数据。
