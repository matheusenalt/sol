"""Evita sugestões erradas e testa conversão de fotos escolhidas pelo usuário."""
from pathlib import Path
from PIL import Image
from soldelivery.images import image_similarity, suggest
from soldelivery.store import Store
from soldelivery.web_images import save_image_from_file


def test_coca_pet_200ml_matches_image_without_pet(tmp_path):
    photo=tmp_path/'COCA COLA 200ML.jpg'
    photo.write_bytes(b'stub')
    assert image_similarity('REFRI COCA PET 200 ML.',photo.stem)>=88
    assert suggest('REFRI COCA PET 200 ML.',[{'path':str(photo),'stem':photo.stem}],1)


def test_volume_sugar_flavor_brand_and_packaging_protections():
    assert image_similarity('REFRI COCA PET 200ML','COCA COLA 600ML')==0
    assert image_similarity('COCA COLA SEM AÇÚCAR 2,25L','COCA COLA 2,25L')==0
    assert image_similarity('FANTA UVA 2L','FANTA LARANJA 2L')==0
    assert image_similarity('COCA COLA 200ML','PEPSI 200ML')==0
    assert image_similarity('COCA COLA PET 200ML','COCA COLA LATA 200ML')==0
    assert image_similarity('REFRI COCA COLA ZERO 600ML','COCA COLA ZERO 600ML')>=90


def test_manual_web_image_import_is_local_jpeg_and_persists(tmp_path,monkeypatch):
    monkeypatch.setenv('LOCALAPPDATA',str(tmp_path/'appdata'))
    src=tmp_path/'produto.webp'
    Image.new('RGBA',(100,80),(255,0,0,120)).save(src)
    saved=Path(save_image_from_file(src,'COCA COLA PET 200ML.'))
    assert saved.is_file() and saved.suffix=='.jpg'
    with Image.open(saved) as pic:
        assert pic.format=='JPEG' and pic.size==(100,80)
    db=Store(tmp_path/'db.sqlite')
    db.register_image(str(saved),"COCA COLA PET 200ML.")
    assert len(db.image_rows())==1
    assert suggest("COCA PET 200 ML",db.image_rows(),1)
    folder=tmp_path/'other'
    folder.mkdir()
    db.index_image_folder(str(folder))
    assert len(db.image_rows())==1  # reindexação não apaga imagens importadas
    assert suggest("COCA PET 200 ML",db.image_rows(),1)
    db.close()
