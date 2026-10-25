import json,os,struct,subprocess,sys,urllib.request
from pathlib import Path
import psutil
ROOT=Path(__file__).resolve().parents[1];runtime=ROOT/"build/runtime"
id=(runtime/"extension-id.txt").read_text().strip()
payload=json.dumps({"command":"ensure"}).encode()
env={**os.environ,"MWT_DATA":str(ROOT/".local/native-test")}
result=subprocess.run([str(runtime/"mwt-host.exe"),"chrome-extension://"+id+"/"],input=struct.pack("<I",len(payload))+payload,capture_output=True,env=env,timeout=60)
if not result.stdout:raise RuntimeError("Native host returned no message: "+result.stderr.decode(errors="replace")[:500])
size=struct.unpack("<I",result.stdout[:4])[0];message=json.loads(result.stdout[4:4+size])
if "error" in message:raise RuntimeError(message["error"])
req=urllib.request.Request(message["url"]+"/v1/health",headers={"Authorization":"Bearer "+message["token"]})
with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req) as response:health=json.load(response)
print(json.dumps({"native_protocol":message["protocol"],"version":health["version"],"models_ready":health["models_ready"]}))
pid=health.get("pid")
if pid:
    process=psutil.Process(pid)
    if Path(process.exe()).resolve().is_relative_to(runtime.resolve()) and process.environ().get("MWT_DATA")==env["MWT_DATA"]:
        process.terminate();process.wait(timeout=15)
