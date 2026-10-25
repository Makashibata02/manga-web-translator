"""Verify release boundaries, checksums and ZIP integrity without inspecting user credentials."""
import hashlib,json,re,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1];release=root/"dist/release-0.1.1"
checks={}
for line in (release/"SHA256SUMS.txt").read_text().splitlines():
    expected,name=line.split("  ",1)
    with (release/name).open("rb") as f:actual=hashlib.file_digest(f,"sha256").hexdigest()
    assert actual==expected,name
checks["checksums"]=True
for archive in release.glob("*.zip"):
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None,archive.name
        names=z.namelist()
        forbidden=[n for n in names if any(p in n.split("/") for p in (".local","profiles","jobs","node_modules",".git")) or n.endswith((".db",".sqlite","service-token",".env"))]
        assert not forbidden,(archive.name,forbidden)
        checks[archive.name]={"files":len(names),"crc":True,"no_user_data_paths":True}
with zipfile.ZipFile(release/"chrome-extension-0.1.1.zip") as z:
    manifest=json.loads(z.read("manifest.json"))
    assert manifest["version"]=="0.1.1"
    assert not any(token in z.read('background.js').decode() for token in ('ui-test-placeholder','owned-settings-placeholder','owned-mock-placeholder','docs-test-placeholder'))
    checks["production_extension"]=True
with zipfile.ZipFile(release/"manga-web-translator-0.1.1-source.zip") as z:
    matches=[]
    for name in z.namelist():
        data=z.read(name).decode("utf8",errors="ignore")
        # Exact actual-looking provider/GitHub credential shapes, never print matched values.
        if re.search(r"\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,})\b",data):matches.append(name)
    assert not matches,{"sensitive_pattern_files":matches}
    checks["source_credential_patterns"]=0
meta=json.loads((release/"release.json").read_text());checks["sizes"]=meta
(root/".local").mkdir(exist_ok=True)
(root/".local/release-validation.json").write_text(json.dumps(checks,indent=2),encoding="utf8")
print(json.dumps(checks,indent=2))
