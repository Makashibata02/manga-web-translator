import json,os
from pathlib import Path
from types import SimpleNamespace
import httpx
import numpy as np
from PIL import Image,ImageDraw
from engine.vision import Vision,text_plan
from engine.store import Store
from engine.translate import Translator

FONT=str(Path(os.environ['WINDIR'])/'Fonts/msyh.ttc')


def test_vertical_ltr_rtl_and_glyphs_remain_inside_bubble():
    image=Image.new('RGB',(160,220),'white');draw=ImageDraw.Draw(image)
    r={'box':[20,20,140,200],'translation':'甲乙丙丁戊己庚辛壬癸子丑','vertical':True,'column_order':'ltr','font_size':30}
    font,positions=text_plan(draw,FONT,r)
    assert positions[0][1]<positions[-1][1]
    for value,x,y in positions:
        box=draw.textbbox((x,y),value,font=font,anchor='mm')
        assert box[0]>=20 and box[1]>=20 and box[2]<=140 and box[3]<=200
    r['column_order']='rtl';_,reverse=text_plan(draw,FONT,r)
    assert reverse[0][1]>reverse[-1][1]


def test_impossible_bubble_does_not_erase_before_fitting(tmp_path):
    source=tmp_path/'source.png';Image.new('RGB',(100,100),'#64788c').save(source)
    work=tmp_path/'work';work.mkdir();Image.new('L',(100,100),255).save(work/'mask.png')
    vision=Vision(tmp_path)
    def forbidden(*args):raise AssertionError('Unfittable translation erased original')
    vision.inpaint=forbidden
    regions=[{'id':'0','box':[20,20,28,28],'translation':'无法放入这么多文字','vertical':True,'column_order':'ltr','note':''}]
    output=vision.render(source,work,regions)
    assert regions[0]['note'] and np.array_equal(np.asarray(Image.open(source)),np.asarray(Image.open(output)))


def test_seam_merge_recomputes_direction_before_recognizing(tmp_path):
    source=tmp_path/'source.png';Image.new('RGB',(600,2000),'white').save(source)
    vision=Vision(tmp_path);count=[0]
    def rapid(image):
        if image.shape[0]==1600:return [([[210,1545],[440,1545],[440,1580],[210,1580]],'短い行',.99)],None
        return [([[210,340],[245,340],[245,620],[210,620]],'永大の奇跡です',.99),([[270,340],[305,340],[305,620],[270,620]],'手術歴三十年です',.99)],None
    vision.rapid=rapid
    def detector(image,**kwargs):
        first=count[0]==0;count[0]+=1
        block=SimpleNamespace(xyxy=[200,1540,450,1590] if first else [200,340,450,650],vertical=not first,font_size=30)
        return None,np.zeros(image.shape[:2],np.uint8),[block]
    vision.detector=detector;vision.ocr=lambda image:'永大の奇跡手術歴三十年です'
    regions=vision.detect(source,tmp_path/'work')
    assert len(regions)==1 and regions[0]['vertical_source'] is True
    assert regions[0]['source']=='永大の奇跡手術歴三十年です'


PROFILE={'id':'test-layout','provider':'openai','endpoint':'https://model.example/v1','model':'test-layout','input_yuan_per_million':2,'output_yuan_per_million':8,'max_output':512}
HINT={'source_vertical':True,'source_confidence':.9,'source_column_order':'rtl','box':[10,20,90,180],'fallback':'vertical-ltr'}

def response(content):
    return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(content)}}],'usage':{'prompt_tokens':100,'completion_tokens':20,'total_tokens':120}})


def test_model_translation_and_layout_share_one_request_and_cache(tmp_path):
    store=Store(tmp_path);b=store.create({'chapter_id':'layout'},PROFILE);seen=[]
    def handler(request):
        body=json.loads(request.content);seen.append(body)
        assert 'image_url' not in request.content.decode() and 'data:image' not in request.content.decode()
        assert json.loads(body['messages'][1]['content'])['layout']['0:0']['source_vertical'] is True
        return response({'translations':{'0:0':'请不要去。'},'layouts':{'0:0':{'mode':'vertical-rtl','confidence':.95}}})
    translator=Translator(store,key_reader=lambda _:'placeholder',transport=httpx.MockTransport(handler));layout={}
    assert translator.translate(b,{'0:0':'行かないで。'},layout_hints={'0:0':HINT},layout_results=layout)=={'0:0':'请不要去。'}
    restored={};translator.translate(b,{'0:0':'行かないで。'},layout_hints={'0:0':HINT},layout_results=restored)
    assert layout==restored=={'0:0':{'mode':'vertical-rtl','confidence':.95}}
    assert len(seen)==1 and store.get('batch',b['id'])['usage']['tokens']==120
    assert store.get('batch',b['id'])['usage']['reserved_tokens']==0


def test_invalid_layout_does_not_repeat_translation_or_change_geometry(tmp_path):
    store=Store(tmp_path);b=store.create({'chapter_id':'invalid'},PROFILE);calls=[]
    def handler(request):
        calls.append(1)
        return response({'translations':{'0':'你好'},'layouts':{'0':{'mode':'anything','confidence':1,'box':[-1,-1,99999,99999]}}})
    layout={};translator=Translator(store,key_reader=lambda _:'placeholder',transport=httpx.MockTransport(handler))
    assert translator.translate(b,{'0':'こんにちは'},layout_hints={'0':HINT},layout_results=layout)=={'0':'你好'}
    assert layout=={} and len(calls)==1 and HINT['box']==[10,20,90,180]
    assert store.get('batch',b['id'])['usage']['tokens']==120


def test_layout_metadata_isolated_from_plain_text_cache(tmp_path):
    store=Store(tmp_path);b=store.create({'chapter_id':'cache'},PROFILE);calls=[]
    def handler(request):
        calls.append(1);payload=json.loads(json.loads(request.content)['messages'][1]['content'])
        return response({'translations':{'0':'你好'},'layouts':{'0':{'mode':'horizontal','confidence':.95}}} if 'layout' in payload else {'0':'你好'})
    translator=Translator(store,key_reader=lambda _:'placeholder',transport=httpx.MockTransport(handler))
    translator.translate(b,{'0':'こんにちは'});layout={}
    translator.translate(b,{'0':'こんにちは'},layout_hints={'0':HINT},layout_results=layout)
    assert len(calls)==2 and layout['0']['mode']=='horizontal'


def test_large_regular_vertical_caption_is_not_rejected_as_artwork(tmp_path):
    source=tmp_path/'caption.png';Image.new('RGB',(600,900),'white').save(source)
    vision=Vision(tmp_path)
    vision.rapid=lambda image:([([[105,105],[225,105],[225,680],[105,680]],'僕が本物の医者になれるかどうか',.99)],None)
    vision.detector=lambda image,**kwargs:(None,np.zeros(image.shape[:2],np.uint8),[SimpleNamespace(xyxy=[100,100,240,700],vertical=True,font_size=120)])
    vision.ocr=lambda image:'僕が本物の医者になれるかどうか'
    regions=vision.detect(source,tmp_path/'work')
    assert regions[0]['source']=='僕が本物の医者になれるかどうか' and not regions[0]['note']


def test_partly_recognized_chapter_heading_is_not_erased(tmp_path):
    source=tmp_path/'title.png';Image.new('RGB',(600,900),'white').save(source)
    vision=Vision(tmp_path)
    vision.rapid=lambda image:([([[35,35],[200,35],[200,55],[35,55]],'第２話',.99)],None)
    vision.detector=lambda image,**kwargs:(None,np.zeros(image.shape[:2],np.uint8),[SimpleNamespace(xyxy=[30,30,530,100],vertical=False,font_size=20)])
    vision.ocr=lambda image:'第２話'
    regions=vision.detect(source,tmp_path/'work')
    assert regions[0]['preserve_reason']=='artwork' and regions[0]['note']


def test_short_uncertain_sound_is_preserved_instead_of_translated_as_a_person(tmp_path):
    source=tmp_path/'sound.png';Image.new('RGB',(600,900),'white').save(source)
    vision=Vision(tmp_path)
    vision.rapid=lambda image:([([[20,20],[60,20],[60,120],[20,120]],'モゴ',.99)],None)
    vision.detector=lambda image,**kwargs:(None,np.zeros(image.shape[:2],np.uint8),[SimpleNamespace(xyxy=[20,20,60,120],vertical=True,font_size=30)])
    vision.ocr=lambda image:'モゴ'
    regions=vision.detect(source,tmp_path/'work')
    assert regions[0]['preserve_reason']=='short_katakana' and not regions[0]['translation']


def test_ascii_ellipsis_does_not_create_a_punctuation_only_column():
    draw=ImageDraw.Draw(Image.new('RGB',(200,900),'white'))
    region={'box':[20,20,140,840],'translation':'在我身上测试过......！！','vertical':True,'column_order':'ltr','font_size':48}
    font,positions=text_plan(draw,FONT,region)
    assert len({x for text,x,y in positions})==1
    assert region['translation']=='在我身上测试过......！！'
