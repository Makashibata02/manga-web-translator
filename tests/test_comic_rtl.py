import json,os
from pathlib import Path
from PIL import Image,ImageDraw
from fastapi.testclient import TestClient
from engine.store import Store,digest,atomic_json
from engine.runner import Runner,apply_comic_layout
from engine.vision import text_plan
from engine.server import create_app

PROFILE={'id':'owned-rtl','provider':'mock','test_only':True}

def region():
 return {'id':'0','source':'こんにちは','translation':'甲乙丙丁戊己庚辛壬癸子丑','box':[20,20,160,220],'vertical':False,'column_order':'ltr','layout_origin':'model','note':''}

def test_comic_chinese_direction_overrides_model_and_keeps_manual_and_other_languages():
 b={'kind':'manga','target':'zh-CN'};r=region()
 assert apply_comic_layout(b,[r]) and r['vertical'] and r['column_order']=='rtl'
 assert not apply_comic_layout(b,[r])
 manual=dict(region(),layout_origin='user');before=manual.copy()
 assert not apply_comic_layout(b,[manual]) and manual==before
 ordinary=region();before=ordinary.copy()
 assert not apply_comic_layout({'kind':'image','target':'zh-CN'},[ordinary]) and ordinary==before
 assert not apply_comic_layout({'kind':'manga','target':'en'},[ordinary]) and ordinary==before

def test_default_vertical_glyph_columns_read_right_to_left_inside_region():
 draw=ImageDraw.Draw(Image.new('RGB',(200,250),'white'));r=region();r.update(vertical=True,font_size=30);r.pop('column_order')
 font,positions=text_plan(draw,str(Path(os.environ['WINDIR'])/'Fonts/msyh.ttc'),r)
 assert positions[0][1]>positions[-1][1]
 assert positions[0][2]<positions[1][2]
 for text,x,y in positions:
  left,top,right,bottom=draw.textbbox((x,y),text,font=font,anchor='mm')
  assert left>=20 and top>=20 and right<=160 and bottom<=220

def test_cached_left_to_right_output_is_only_rerendered_without_another_request(tmp_path):
 class Vision:
  calls=0
  def detect(self,*a):raise AssertionError('Cached translation must not redo OCR')
  def render(self,source,work,regions,checkpoint):
   self.calls+=1;assert regions[0]['vertical'] and regions[0]['column_order']=='rtl'
   Image.new('RGB',(200,250),'white').save(work/'translated.png');atomic_json(work/'translated.json',regions)
 class Translator:
  def translate(self,*a,**k):raise AssertionError('Changing direction must not call a model')
 s=Store(tmp_path);b=s.create({'chapter_id':'owned-cache','pages':[{'index':0},{'index':1}],'total':2,'complete':True},PROFILE)
 for i in (0,1):s.image(b['id'],i,'owned-image')
 key=digest(['owned-image',b['source'],b['target'],b['profile'],b['kind'],b['rules'],b['glossary']]);work=tmp_path/'cache'/key;work.mkdir(parents=True)
 Image.new('RGB',(200,250),'white').save(work/'translated.png');atomic_json(work/'translated.json',[region()])
 receipt=s.reserve(b['id'],'already-paid',100,.01);s.settle(receipt,{'0':'已缓存译文'},70,.007);usage=s.get('batch',b['id'])['usage'];audit=s.all('request')
 v=Vision();runner=Runner(s,tmp_path,vision=v,translator=Translator());runner.process(*s.claim());runner.process(*s.claim());current=s.get('batch',b['id'])
 assert current['state']=='completed' and v.calls==1 and current['usage']==usage and s.all('request')==audit
 assert all(p['regions'][0]['column_order']=='rtl' for p in current['pages'])
 assert current['pages'][0]['render_version']==1

def test_new_manga_model_suggestion_cannot_switch_output_to_horizontal(tmp_path):
 class Vision:
  def detect(self,source,work,kind,checkpoint):
   work.mkdir(parents=True,exist_ok=True);Image.new('L',(200,250),0).save(work/'mask.png');return [dict(region(),translation='')]
  def render(self,source,work,regions,checkpoint):
   assert regions[0]['vertical'] and regions[0]['column_order']=='rtl'
   Image.new('RGB',(200,250),'white').save(work/'translated.png');atomic_json(work/'translated.json',regions)
 class Translator:
  def translate(self,b,blocks,scope,layout_hints=None,layout_results=None):
   layout_results.update({k:{'mode':'horizontal','confidence':1} for k in blocks});return {k:'甲乙丙丁' for k in blocks}
 s=Store(tmp_path);b=s.create({'chapter_id':'owned-model','pages':[{'index':0}],'complete':True,'total':1},dict(PROFILE,provider='openai'));s.image(b['id'],0,'owned-image')
 Runner(s,tmp_path,vision=Vision(),translator=Translator()).process(*s.claim());result=s.get('batch',b['id'])
 assert result['state']=='completed' and result['usage']['requests']==0 and result['pages'][0]['regions'][0]['column_order']=='rtl'

def test_manual_edit_can_still_choose_left_to_right_without_calling_model(tmp_path):
 app=create_app(tmp_path,token='owned-rtl-placeholder',run=False);s=app.state.store
 b=s.create({'chapter_id':'owned-edit','pages':[{'index':0}],'complete':True,'total':1},PROFILE);page=s.image(b['id'],0,'owned-image')
 (tmp_path/'images').mkdir();Image.new('RGB',(200,250),'white').save(tmp_path/'images/owned-image.png');work=tmp_path/'cache/owned-cache';work.mkdir(parents=True);Image.new('L',(200,250),0).save(work/'mask.png')
 s.patch_page(b['id'],0,page['revision'],regions=[dict(region(),vertical=True,column_order='rtl')],cache_key='owned-cache',state='completed')
 with TestClient(app) as client:
  response=client.post('/v1/batches/'+b['id']+'/pages/0/edit',headers={'Authorization':'Bearer owned-rtl-placeholder'},json={'regions':[{'id':'0','vertical':True,'column_order':'ltr'}]})
  assert response.status_code==200;edited=response.json()['pages'][0]['regions'][0]
  assert edited['column_order']=='ltr' and edited['layout_origin']=='user' and not s.all('request')
