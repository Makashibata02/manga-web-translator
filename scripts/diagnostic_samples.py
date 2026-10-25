"""Twelve self-created layout fixtures; translation quality is not inferred from these."""
import json, time, threading
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import psutil
from engine.vision import Vision
R=Path(__file__).resolve().parents[1];folder=R/".local/sample-set-v2";folder.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",34)
samples=[]
for case in ("horizontal","vertical","two_bubbles","colored","small","seam"):
 for revision in range(2):
  h=2200 if case=="seam" else 1100;image=Image.new("RGB",(800,h),"#d8e7ea" if case=="colored" else "white");draw=ImageDraw.Draw(image)
  y=1380 if case=="seam" else 130
  draw.rounded_rectangle((50,y-30,750,min(h-30,y+360)),radius=70,outline="black",width=3,fill="#e9ebe8" if case=="colored" else "white")
  text="今日はいい天気です。" if revision==0 else "これはテストです。"
  if case=="vertical":
   for i,c in enumerate(text):draw.text((550,y+i*36),c,font=font,fill="black")
  else:draw.text((130,y+70),text,font=font,fill="black")
  if case=="two_bubbles":
   draw.ellipse((150,630,700,1030),outline="black",width=3);draw.text((230,770),"行かないで。",font=font,fill="black")
  if case=="small":image=image.resize((480,660))
  path=folder/(case+str(revision)+".png");image.save(path);samples.append((path,text,case))
v=Vision(R/"models");report=[]
for path,expected,case in samples:
 start=time.monotonic()
 try:
  blocks=v.detect(path,folder/path.stem)
  report.append({"file":path.name,"case":case,"expected":expected,"ocr":[b["source"] for b in blocks],"regions":len(blocks),"seconds":round(time.monotonic()-start,2),"main_phrase_found":expected in "".join(b["source"] for b in blocks)})
 except Exception as e:report.append({"file":path.name,"error":str(e)})
 print(path.name,report[-1].get("regions"),report[-1].get("main_phrase_found"),flush=True)
(folder/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf8")
