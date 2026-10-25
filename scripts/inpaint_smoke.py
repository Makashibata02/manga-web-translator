import json,time
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from engine.vision import Vision
root=Path(__file__).resolve().parents[1];folder=root/".local/other-pipelines";folder.mkdir(parents=True,exist_ok=True)
v=Vision(root/"models");start=time.monotonic()
source=root/".local/sample-set-v2/colored0.png";work=folder/"colored-final"
regions=v.detect(source,work)
for r in regions:r["translation"]="今天的天气很好。"
out=v.render(source,work,regions)
image=Image.new("RGB",(800,500),"white");draw=ImageDraw.Draw(image);draw.text((70,130),"Do not change 12.",font=ImageFont.truetype("C:/Windows/Fonts/arial.ttf",38),fill="black")
image.save(folder/"ordinary.png")
ordinary=v.detect(folder/"ordinary.png",folder/"ordinary",kind="image")
assert any("12" in r["source"] for r in ordinary),ordinary
report={"lama_loaded":v.lama is not None,"ordinary_ocr":[r["source"] for r in ordinary],"seconds":round(time.monotonic()-start,2),"output":out.name}
(folder/"report.json").write_text(json.dumps(report,indent=2),encoding="utf8");print(report)
