from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json
ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/".local/fixtures";folder.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",34)
image=Image.new("RGB",(800,1200),"#f2e9da");d=ImageDraw.Draw(image)
d.rectangle((20,20,780,560),outline="black",width=4);d.rectangle((20,590,780,1180),outline="black",width=4)
d.ellipse((410,80,730,400),fill="white",outline="black",width=3)
d.multiline_text((455,170),"こんにちは。\n今日はいい天気\nですね。",font=font,fill="black",spacing=9)
d.ellipse((70,660,430,1040),fill="white",outline="black",width=3)
d.multiline_text((120,760),"これはテストです。\n数字は12です。\n行かないで。",font=font,fill="black",spacing=9)
image.save(folder/"japanese.png")
long=Image.new("RGB",(800,20000),"white")
for y in range(0,20000,1200):long.paste(image,(0,y))
long.save(folder/"long.png")
icon=Image.new("RGB",(128,128),"#6550d9");draw=ImageDraw.Draw(icon);draw.rounded_rectangle((18,20,110,96),radius=16,fill="white");draw.text((34,22),"译",font=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",60),fill="#6550d9")
icon.save(ROOT/"extension/static/icon.png")
print(folder)
