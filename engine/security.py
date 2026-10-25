import secrets, os
from pathlib import Path

def data_root():
    return Path(os.environ.get("MWT_DATA", str(Path(os.environ.get("LOCALAPPDATA", Path.home())) / "MangaWebTranslator")))

def token_file(root):
    root.mkdir(parents=True, exist_ok=True)
    p=root/"service-token"
    if not p.exists():
        p.write_text(secrets.token_urlsafe(32), encoding="utf8")
    return p.read_text(encoding="utf8").strip()

def save_key(profile_id, value):
    import keyring
    keyring.set_password("MangaWebTranslator", profile_id, value)

def read_key(profile_id):
    import keyring
    value=keyring.get_password("MangaWebTranslator", profile_id)
    if not value: raise ValueError("尚未保存 API Key")
    return value
