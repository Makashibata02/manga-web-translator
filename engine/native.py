"""Native Messaging bootstrap; no image payloads and no arbitrary command execution."""
import json, os, socket, struct, subprocess, sys, time, urllib.request
from pathlib import Path
from .security import data_root, token_file

def read_message():
    head=sys.stdin.buffer.read(4)
    if len(head)!=4: return None
    size=struct.unpack("<I",head)[0]
    if size>65536: raise ValueError("消息过大")
    data=sys.stdin.buffer.read(size)
    if len(data)!=size: raise ValueError("消息不完整")
    return json.loads(data)

def reply(value):
    data=json.dumps(value).encode()
    sys.stdout.buffer.write(struct.pack("<I",len(data))+data); sys.stdout.buffer.flush()

def _main():
    root=Path(__file__).resolve().parents[1]
    if getattr(sys,"frozen",False): root=Path(sys.executable).parent
    id=(root/"extension-id.txt").read_text().strip()
    if len(sys.argv)<2 or sys.argv[1]!="chrome-extension://"+id+"/": raise ValueError("不允许的扩展")
    message=read_message()
    if not message or message.get("command")!="ensure": raise ValueError("不允许的命令")
    token=token_file(data_root()); port=18767
    def healthy():
        try:
            req=urllib.request.Request(f"http://127.0.0.1:{port}/v1/health",headers={"Authorization":"Bearer "+token})
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(req,timeout=2) as response: return json.load(response).get("protocol")==1
        except Exception: return False
    if not healthy():
        with socket.socket() as s:
            try: s.bind(("127.0.0.1",port))
            except OSError: raise ValueError("18767端口已被其他程序占用")
        exe=root/"python"/"pythonw.exe"
        if not exe.exists(): exe=Path(sys.executable).with_name("pythonw.exe")
        env={**os.environ,"PYTHONPATH":str(root),"MWT_MODELS":str(root/"models")}
        log=(data_root()/"engine.log").open("ab")
        subprocess.Popen([str(exe),"-m","engine.server","--port",str(port),"--extension-id",id],cwd=root,env=env,
                         creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0),stdin=subprocess.DEVNULL,stdout=log,stderr=log)
        log.close()
        for _ in range(100):
            if healthy(): break
            time.sleep(.2)
        else: raise ValueError("引擎未能启动，请重新运行安装程序检查资源")
    reply({"url":f"http://127.0.0.1:{port}","token":token,"protocol":1})
def main():
    # Serialize concurrent bootstrap calls from separate Chrome profiles.
    import msvcrt
    path=data_root();path.mkdir(parents=True,exist_ok=True)
    with (path/"bootstrap.lock").open("a+b") as lock:
        if lock.tell()==0:lock.write(b"0");lock.flush()
        lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_LOCK,1)
        try:_main()
        finally:
            lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1)
if __name__=="__main__":
    try: main()
    except Exception as e: reply({"error":str(e)})
