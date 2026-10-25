import json,os,sys,threading,shutil,uuid
from pathlib import Path
import tkinter as tk
from tkinter import ttk
import winreg
from scripts.install_runtime import VERSION,stage_runtime,pause_old_engine
BASE=Path(sys.executable).parent if getattr(sys,"frozen",False) else Path(__file__).resolve().parents[1]/("dist/release-"+VERSION)
DATA=Path(os.environ["LOCALAPPDATA"])/"MangaWebTranslator";PARENT=DATA/"runtime";DEST=PARENT/VERSION
window=tk.Tk();window.title("漫译 · 安装 / 升级 "+VERSION);window.geometry("590x310")
ttk.Label(window,text="漫译 · 免费优先，一键翻译",font=("Microsoft YaHei",16)).pack(pady=18)
ttk.Label(window,text="已有引擎将复用 Python 与模型，保留任务、凭据和累计用量。\n升级会暂停未完成任务；请将安装包与 release.json 放在此程序旁。").pack()
status=tk.StringVar(value="准备安装或升级");ttk.Label(window,textvariable=status,wraplength=540).pack(pady=12)
bar=ttk.Progressbar(window,length=510,maximum=100);bar.pack(pady=8)
def report(text,percent):window.after(0,lambda:(status.set(text),bar.configure(value=percent)))
def install():
    staging=None;previous=None
    try:
        staging=stage_runtime(BASE,PARENT,report)
        pause_old_engine(DATA,PARENT,report)
        if DEST.exists():
            previous=PARENT/(".replaced-"+uuid.uuid4().hex);DEST.rename(previous)
        staging.rename(DEST);staging=None
        id=(DEST/"extension-id.txt").read_text().strip()
        manifest={"name":"org.manga_web_translator.host","description":"Manga Web Translator local bootstrap","path":str(DEST/"mwt-host.exe"),"type":"stdio","allowed_origins":["chrome-extension://"+id+"/"]}
        mp=DEST/"native-host.json";mp.write_text(json.dumps(manifest),encoding="utf8")
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER,r"Software\Google\Chrome\NativeMessagingHosts\org.manga_web_translator.host") as key:winreg.SetValueEx(key,"",0,winreg.REG_SZ,str(mp))
        if previous and previous.exists():shutil.rmtree(previous)
        report("安装完成。请重新加载 Chrome 扩展；默认免费腾讯，无需 Key。",100)
    except Exception as e:
        report("安装未完成："+str(e),0)
        if staging and staging.exists() and staging.resolve().is_relative_to(PARENT.resolve()):shutil.rmtree(staging)
        if previous and previous.exists():
            if DEST.exists() and DEST.resolve().is_relative_to(PARENT.resolve()):shutil.rmtree(DEST)
            previous.rename(DEST)
    finally:window.after(0,lambda:button.configure(state="normal"))
def start():button.configure(state="disabled");threading.Thread(target=install,daemon=True).start()
button=ttk.Button(window,text="安装 / 升级到 "+VERSION,command=start);button.pack(pady=12)
window.mainloop()
