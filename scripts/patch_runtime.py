"""Reproduce the Manga OCR compatibility adjustments in the packaged runtime."""
from pathlib import Path

def patch_manga_ocr(site_packages):
    path=Path(site_packages)/'manga_ocr/ocr.py';text=path.read_text(encoding='utf8')
    if 'class MangaOcrModel(' not in text:
        original='from transformers import ViTImageProcessor, AutoTokenizer, VisionEncoderDecoderModel'
        if original not in text:raise ValueError('Unexpected Manga OCR source; inspect before packaging')
        text=text.replace(original,original+', GenerationMixin',1)
        text=text.replace('class MangaOcr:', 'class MangaOcrModel(VisionEncoderDecoderModel, GenerationMixin):\n    pass\n\n\nclass MangaOcr:',1)
        text=text.replace('self.model = VisionEncoderDecoderModel.from_pretrained(', 'self.model = MangaOcrModel.from_pretrained(',1)
    text=text.replace('AutoTokenizer.from_pretrained(pretrained_model_name_or_path)', 'AutoTokenizer.from_pretrained(pretrained_model_name_or_path, tokenizer_type="bert-japanese")')
    if 'tokenizer_type="bert-japanese"' not in text or 'self.model = MangaOcrModel.from_pretrained(' not in text:raise ValueError('Manga OCR compatibility patch not confirmed')
    path.write_text(text,encoding='utf8')
