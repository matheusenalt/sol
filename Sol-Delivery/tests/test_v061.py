"""0.6.1: Navegação rápida e imagens sempre compatíveis com o delivery."""
import sqlite3
import time
from pathlib import Path

import pytest
from PIL import Image

from soldelivery.image_preload import ImageMatcher, build_previews
from soldelivery.store import Store
from soldelivery.web_images import save_image_from_file


def test_library_excludes_incompatible_extensions(tmp_path):
    folder=tmp_path/'biblioteca';folder.mkdir()
    for name in ['COCA COLA 200ML.jpg','REFRI GUARANA.png','COCA ZERO.jpeg',
                 'IMAGEM RUIM.webp','LOGO.bmp','ICON.jfif','GIF.gif']:
        (folder/name).write_bytes(b'placeholder')
    store=Store(tmp_path/'dados.db')
    assert store.index_image_folder(str(folder))==3
    assert {Path(row['path']).suffix.lower() for row in store.image_rows()}=={'.jpg','.jpeg','.png'}
    store.close()


@pytest.mark.parametrize('format,extension', [('WEBP','webp'),('BMP','bmp'),('PNG','png')])
def test_unsupported_source_is_converted_to_real_jpeg(tmp_path,format,extension):
    src=tmp_path/('copiada.'+extension)
    Image.new('RGB',(80,60),'yellow').save(src,format)
    target=tmp_path/'imagens';target.mkdir()
    saved=Path(save_image_from_file(src,'X-BACON.',folder=target))
    assert saved.parent==target
    assert saved.suffix.lower() in ('.jpg','.jpeg','.png')
    with Image.open(saved) as image:
        assert image.format in ('JPEG','PNG')
        image.verify()


def test_preloader_reuses_expected_match_and_preserves_confirmation(tmp_path):
    im_dir=tmp_path/'images';im_dir.mkdir()
    img=im_dir/'COCA COLA 200ML.jpg';img.touch()
    mismatch=im_dir/'COCA COLA 600ML.jpg';mismatch.touch()
    photos=[{'path':str(img),'stem':img.stem}, {'path':str(mismatch),'stem':mismatch.stem}]
    products=[{'id':1,'name':'REFRI COCA PET 200 ML.','description':'','image_path':''},
              {'id':2,'name':'REFRI COCA COLA 600ML.','description':'','image_path':''},
              {'id':3,'name':'REFRI COCA PET 200 ML.','description':'','image_path':str(mismatch)}]
    previews=build_previews(products,photos)
    assert previews[1][2]==str(img)
    assert previews[2][2]==str(mismatch)
    assert previews[3][2]==''  # usa caminho escolhido, não pesquisa de novo


def test_old_batch_completion_migrates_without_reset(tmp_path):
    from soldelivery.core import Extracted
    db=Store(tmp_path/'db.sqlite')
    row=Extracted(name='COCA COLA 200ML.',category='BEBIDAS',price_cents=450,status='reconhecido')
    batch=db.add_batch('Bebidas','origem.csv',[row])
    product=db.products(batch)[0]
    db.mark_completed(product['id'],True)
    db.close()
    reopened=Store(tmp_path/'db.sqlite')
    assert reopened.products(batch)[0]['completed']==1
    reopened.close()


def test_minimatch_avoids_thousands_of_unrelated_comparisons(tmp_path,monkeypatch):
    # Biblioteca grande; only a subset of names shares a token. The inverted
    # index should compare the candidates, not every image for every product.
    folder=tmp_path/'fotos';folder.mkdir()
    pics=[]
    for i in range(900):
        photo=folder/f'MARCA{i} ITEM{i}.jpg';photo.touch()
        pics.append({'path':str(photo),'stem':photo.stem})
    name=folder/'COCA COLA 200ML.jpg';name.touch()
    pics.append({'path':str(name),'stem':name.stem})
    matcher=ImageMatcher(pics)
    assert matcher.best('REFRI COCA PET 200ML.')==str(name)
    # No specific timing threshold: Windows VM and CI vary widely.
