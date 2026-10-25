"""Transactional installation helpers, independently testable without GUI/registry."""
import hashlib,json,os,shutil,subprocess,uuid,zipfile
from pathlib import Path
VERSION="0.1.1"
def safe_extract(archive,staging,progress=lambda x:None):
    base=staging.resolve()
    with zipfile.ZipFile(archive) as z:
        infos=z.infolist()
        for i,info in enumerate(infos):
            target=(staging/info.filename).resolve()
            if not target.is_relative_to(base):raise ValueError("压缩包包含非法路径")
            # Never overwrite a reused hard link in place.
            if target.is_file():target.unlink()
            z.extract(info,staging)
            if i%200==0:progress(i/max(1,len(infos)))
def link_or_copy(source,target):
    try:os.link(source,target)
    except OSError:shutil.copy2(source,target)
    return str(target)
def stage_runtime(folder,runtime_parent,progress=lambda text,p:None,check=True):
    folder=Path(folder);runtime_parent=Path(runtime_parent)
    installed=next((p for p in sorted(runtime_parent.glob("*"),reverse=True) if not p.name.startswith(".") and (p/"python/python.exe").is_file() and (p/"models/manifest.json").is_file()),None)
    update=folder/"runtime-update.zip";full=folder/"engine.zip"
    archive=update if installed and update.exists() else full
    if not archive.exists():raise ValueError("首次安装需要 engine.zip；已有引擎可使用 runtime-update.zip")
    meta=json.loads((folder/"release.json").read_text(encoding="utf8"))
    expected=meta["update_sha256" if archive==update else "engine_sha256"]
    progress("校验安装包…",5)
    with archive.open("rb") as f:
        if hashlib.file_digest(f,"sha256").hexdigest()!=expected:raise ValueError("安装包校验失败")
    staging=runtime_parent/(".install-"+uuid.uuid4().hex);staging.mkdir(parents=True)
    try:
        if archive==update:
            progress("复用已安装的离线模型与 Python…",15)
            if hashlib.sha256((installed/"models/manifest.json").read_bytes()).hexdigest()!=meta["model_manifest_sha256"]:
                raise ValueError("旧模型版本不匹配，请使用完整 engine.zip")
            shutil.copytree(installed,staging,dirs_exist_ok=True,copy_function=link_or_copy,ignore=shutil.ignore_patterns("__pycache__","*.pyc","native-host.json"))
        safe_extract(archive,staging,lambda p:progress("解压并准备资源…",20+65*p))
        if check:
            progress("检查运行环境…",88)
            r=subprocess.run([str(staging/"python/python.exe"),"-c","import fastapi,torch,cv2,manga_ocr;from engine import __version__;assert __version__=='0.1.1'"],cwd=staging,capture_output=True,timeout=120,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
            if r.returncode:raise ValueError("环境检查失败，旧安装未改变")
        return staging
    except Exception:
        if staging.resolve().is_relative_to(runtime_parent.resolve()):shutil.rmtree(staging)
        raise
def pause_old_engine(data,allowed_root,progress=lambda text,p:None):
    """Read only the local service token, never model credentials; stop only this app's process."""
    import urllib.request,time,psutil
    data=Path(data);token_path=data/"service-token"
    if not token_path.exists():return
    token=token_path.read_text().strip();opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def request(path,body=None):
        req=urllib.request.Request("http://127.0.0.1:18767"+path,data=json.dumps(body).encode() if body else None,
            headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
        with opener.open(req,timeout=3) as response:return json.load(response)
    try:health=request("/v1/health")
    except Exception:return
    process=psutil.Process(health["pid"])
    if not Path(process.exe()).resolve().is_relative_to(Path(allowed_root).resolve()) or "-m" not in process.cmdline() or "engine.server" not in process.cmdline():
        raise ValueError("服务进程不属于本插件，未结束任何进程")
    for b in request("/v1/batches"):
        if b["state"]=="active":request("/v1/batches/"+b["id"]+"/action",{"action":"pause"})
    for _ in range(60):
        batches=request("/v1/batches")
        if not any(b["usage"].get("reserved_tokens",0)>0 and b["state"]!="uncertain" for b in batches):break
        progress("等待正在发送的模型请求结算，任务和用量会保留…",92);time.sleep(1)
    else:raise ValueError("仍有模型请求未结束，请稍后再次升级；没有强制结束")
    process.terminate();process.wait(timeout=10)
