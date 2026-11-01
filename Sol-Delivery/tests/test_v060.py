"""Regressões da 0.6.0: leitura conservadora, migração, imagens e exportação."""
from pathlib import Path
import csv
import json
import sqlite3
from PIL import Image
import pytest

from soldelivery.core import Extracted, parse_lines
from soldelivery.importers import rows_to_products
from soldelivery.store import Store
from soldelivery.images import image_similarity,suggest
from soldelivery.web_images import save_image_from_file
from soldelivery.exporters import export_csv,export_pending,completed_rows


def test_pdf_description_after_price():
    found=parse_lines('LANCHES\nX-BACON 22,50\nPão, bife, bacon, salada',conservative=True)
    assert len(found)==1
    assert found[0].name=='X-BACON.'
    assert found[0].description=='Pão, bife, bacon, salada'
    assert found[0].price_cents==2250
    assert found[0].status=='revisar'


def test_pdf_price_after_name_and_description():
    found=parse_lines('LANCHES\nX-BACON\nPão, bife, bacon, salada\n22,50',conservative=True)
    assert len(found)==1
    assert found[0].price_cents==2250
    assert found[0].description=='Pão, bife, bacon, salada'
    assert found[0].status=='revisar'


def test_tabular_description_separate():
    found=rows_to_products([('PRODUTO','DESCRICAO','PRECO'),('X-BACON','pão, bife, bacon, salada','22,50')])
    assert len(found)==1
    assert found[0].name=='X-BACON.' and found[0].price_cents==2250
    assert found[0].description=='pão, bife, bacon, salada'
    assert found[0].status=='reconhecido'


def test_tabular_description_only_is_name():
    found=rows_to_products([('DESCRICAO','VALOR'),('X-BACON','22,50')])
    assert found[0].name=='X-BACON.'
    assert found[0].description==''
    assert found[0].price_cents==2250


def test_category_mixed_and_unknown_heading():
    parsed=parse_lines('PIZZAS\nPIZZA QUEIJO 25,00\nSUCOS\nSUCO LARANJA 500ML 10,00\nMARMITAS\nMARMITEX 25,00',conservative=True)
    assert [x.category for x in parsed]==['PIZZAS','SUCOS','MARMITAS']
    assert parse_lines('BATATA FRITA',conservative=True)[0].status=='revisar'
    assert parse_lines('BATATA FRITA',conservative=True)[0].category=='SEM CATEGORIA'


def test_migrate_05_preserves_completion_and_image(tmp_path):
    fn=tmp_path/'old.db'
    con=sqlite3.connect(fn)
    con.executescript('''
        CREATE TABLE batches (id INTEGER PRIMARY KEY,name TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE products (id INTEGER PRIMARY KEY,batch_id INTEGER NOT NULL,category TEXT NOT NULL DEFAULT 'SEM CATEGORIA',original_name TEXT NOT NULL,name TEXT NOT NULL,price_cents INTEGER,status TEXT NOT NULL DEFAULT 'revisar',detail TEXT NOT NULL DEFAULT '',source_line TEXT NOT NULL DEFAULT '',completed INTEGER NOT NULL DEFAULT 0,image_path TEXT NOT NULL DEFAULT '',image_confirmed INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE images (path TEXT PRIMARY KEY,stem TEXT NOT NULL);
        CREATE TABLE product_addons (id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL,name TEXT NOT NULL,price_cents INTEGER,position INTEGER NOT NULL DEFAULT 0);
        INSERT INTO batches (id,name,source) VALUES(10,'Teste','cardapio.png');
        INSERT INTO products(id,batch_id,name,original_name,price_cents,category,status,completed,image_path,image_confirmed) VALUES(5,10,'X-BACON.','X-BACON.',2250,'LANCHES','reconhecido',1,'C:/fotos/x-bacon.png',1);
        INSERT INTO product_addons(product_id,name,price_cents) VALUES(5,'CHEDDAR',300);
        INSERT INTO settings(key,value) VALUES('dot','1');
    ''')
    con.commit();con.close()
    store=Store(fn)
    row=store.by_id(5)
    assert row['description']=='' and row['completed']==1 and row['image_confirmed']==1
    assert row['image_path']=='C:/fotos/x-bacon.png' and store.addons(5)[0]['price_cents']==300
    store.update_product(5,row['name'],2250,'LANCHES',True,description='Pão e bacon')
    assert store.by_id(5)['completed']==0
    assert store.by_id(5)['description']=='Pão e bacon'
    store.close()


def test_description_copy_button_visibility_is_conditioned():
    # Contrato GUI: o botão é ligado à presença de texto, sem exigir Qt no CI Linux.
    pytest.importorskip('PySide6')
    from soldelivery import gui
    import inspect
    src=inspect.getsource(gui.MiniWindow.display)
    assert "bool(row['description'].strip())" in src
    assert 'self.copy_description_btn.setVisible(has_description)' in src


def test_food_synonyms_and_size_guards(tmp_path):
    assert image_similarity('PORCAO FRITAS','batata frita porção')>=85
    assert image_similarity('X-BACON','hamburguer-bacon')>=85
    assert image_similarity('PIZZA CALABRESA G','PIZZA CALABRESA P')==0
    assert image_similarity('FRITAS 300G','FRITAS 500G')==0
    assert image_similarity('PIZZA 4 FATIAS','PIZZA 8 FATIAS')==0
    f=tmp_path/'batata frita porção.png'
    f.write_bytes(b'x')
    assert suggest('PORCAO FRITAS',[{'path':str(f),'stem':f.stem}])


def test_copied_photo_saved_in_selected_folder_with_collision_control(tmp_path):
    folder=tmp_path/'IMAGENS PRODUTOS';folder.mkdir()
    src=tmp_path/'foto.png';Image.new('RGBA',(32,24),(255,0,0,120)).save(src)
    path=Path(save_image_from_file(src,'COCA COLA 200ML.',folder))
    assert path.parent==folder and path.name=='COCA COLA 200ML.jpg'
    assert Path(save_image_from_file(src,'COCA COLA 200ML.',folder))==path
    Image.new('RGB',(32,24),'green').save(src)
    second=Path(save_image_from_file(src,'COCA COLA 200ML.',folder))
    assert second!=path and path.exists() and second.exists()
    st=Store(tmp_path/'data.db')
    assert st.index_image_folder(str(folder))==2
    assert suggest('COCA COLA 200ML',st.image_rows())
    st.close()


def test_export_only_completed_with_description_addons_and_profile(tmp_path):
    store=Store(tmp_path/'a.db')
    batch=store.add_batch('a','source',[Extracted('X-BACON.',2250,'LANCHES','reconhecido',description='Pão e bacon'),Extracted('FANTA.',1000,'BEBIDAS','revisar')])
    first=next(r for r in store.products(batch) if r['name']=='X-BACON.')
    store.replace_addons(first['id'],[('CHEDDAR',300)])
    store.mark_completed(first['id'],True)
    csvpath=tmp_path/'products.csv'
    assert export_csv(store,batch,csvpath)==1
    with csvpath.open(encoding='utf-8-sig') as f: rows=list(csv.reader(f,delimiter=';'))
    assert rows[1][1]=='X-BACON.' and rows[1][2]=='Pão e bacon'
    assert 'CHEDDAR' in rows[1][5]
    model=tmp_path/'perfil.json';model.write_text(json.dumps({'colunas':{'Nome do produto':'nome','Valor':'preco'}}),encoding='utf-8')
    assert export_csv(store,batch,tmp_path/'profile.csv',model)==1
    assert (tmp_path/'profile.csv').read_text(encoding='utf-8-sig').splitlines()[0]=='Nome do produto;Valor'
    assert export_pending(store,batch,tmp_path/'pending.csv')==1
    store.close()


def test_mini_copy_description_when_available_qt(tmp_path,monkeypatch):
    pytest.importorskip('PySide6')
    import os
    os.environ.setdefault('QT_QPA_PLATFORM','offscreen')
    from PySide6.QtWidgets import QApplication
    from soldelivery.gui import MainWindow,MiniWindow
    app=QApplication.instance() or QApplication([])
    store=Store(tmp_path/'gui.db')
    batch=store.add_batch('GUI','',[
        Extracted('X-BACON.',2250,'LANCHES','reconhecido',description='pão, bife, bacon'),
        Extracted('ÁGUA.',450,'BEBIDAS','reconhecido')])
    main=MainWindow(store=store)
    mini=MiniWindow(main)
    first=next(r for r in store.products(batch) if r['description'])
    second=next(r for r in store.products(batch) if not r['description'])
    mini.current_id=first['id'];mini.display()
    assert not mini.copy_description_btn.isHidden()
    mini.copy_description()
    assert app.clipboard().text()=='pão, bife, bacon'
    mini.current_id=second['id'];mini.display()
    assert mini.copy_description_btn.isHidden()
    mini.close();main.close()


def test_spreadsheet_uppercase_name_without_price_not_discarded():
    rows=rows_to_products([
        ('PRODUTO','PRECO','CATEGORIA'),
        ('X-BACON','','LANCHES'),
        ('X-EGG',20.00,'LANCHES')
    ])
    assert len(rows)==2
    assert rows[0].name=='X-BACON.'
    assert rows[0].status=='revisar'


def test_description_helps_weak_image_name_without_inventing_match():
    assert image_similarity('LANCHE DA CASA','hamburguer-bacon','pão, hambúrguer, bacon')>=65
    assert image_similarity('LANCHE DA CASA','sorvete morango','pão, hambúrguer, bacon')==0
