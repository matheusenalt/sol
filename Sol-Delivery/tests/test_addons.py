"""Verifica dados existentes, acréscimos, preço editável e ponto final."""
import sqlite3
import pytest
from soldelivery.core import Extracted
from soldelivery.store import Store


def test_addons_are_per_product_and_persist_without_changing_completion(tmp_path):
    path=tmp_path/'soldelivery.db'
    store=Store(path)
    batch=store.add_batch('Cardápio de teste','teste.pdf',[
        Extracted('BATATA FRITA.',2590,'PORÇÕES','reconhecido'),
        Extracted('COCA COLA 600 ML.',875,'BEBIDAS','reconhecido'),
    ])
    fritas=next(r for r in store.products(batch) if 'FRITA' in r['name'])
    coca=next(r for r in store.products(batch) if 'COCA' in r['name'])
    assert not store.addons(fritas['id'])
    store.replace_addons(fritas['id'], [('CHEDDAR',300),('BACON',500),('ADICIONAL SEM PREÇO',None)])
    assert [(x['name'],x['price_cents']) for x in store.addons(fritas['id'])] == [
        ('CHEDDAR',300),('BACON',500),('ADICIONAL SEM PREÇO',None)]
    assert not store.addons(coca['id'])
    store.mark_completed(fritas['id'],True)
    store.close()
    again=Store(path)
    assert len(again.addons(fritas['id']))==3
    assert again.by_id(fritas['id'])['completed']==1
    assert len(again.products(batch))==2
    again.close()


def test_price_edit_does_not_confirm_an_uncertain_item(tmp_path):
    db=Store(tmp_path/'prices.db')
    batch=db.add_batch('t','t.jpg',[Extracted('REFRI ??',None,'BEBIDAS','revisar')])
    row=db.products(batch)[0]
    db.update_price(row['id'],1250)
    after=db.by_id(row['id'])
    assert after['price_cents']==1250 and after['status']=='revisar'
    with pytest.raises(ValueError):db.mark_completed(row['id'],True)
    with pytest.raises(ValueError):db.update_price(row['id'],-1)
    db.close()


def test_dot_toggle_keeps_addons_and_existing_progress(tmp_path):
    db=Store(tmp_path/'dots.db')
    batch=db.add_batch('t','t.xls',[Extracted('PIZZA.',2000,'PIZZAS','reconhecido')])
    item=db.products(batch)[0]
    db.replace_addons(item['id'], [('BORDA RECHEADA', 500)])
    db.mark_completed(item['id'],True)
    db.apply_dot(batch,False)
    assert db.by_id(item['id'])['name']=='PIZZA'
    db.apply_dot(batch,True)
    assert db.by_id(item['id'])['name']=='PIZZA.'
    assert db.by_id(item['id'])['completed']==1
    assert db.addons(item['id'])[0]['name']=='BORDA RECHEADA'
    db.close()


def test_existing_03_database_migrates_without_losing_rows(tmp_path):
    path=tmp_path/'old.db'
    con=sqlite3.connect(path)
    con.executescript('''
        CREATE TABLE batches(id INTEGER PRIMARY KEY,name TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE products(id INTEGER PRIMARY KEY,batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,category TEXT NOT NULL DEFAULT 'SEM CATEGORIA', original_name TEXT NOT NULL,name TEXT NOT NULL,price_cents INTEGER,status TEXT NOT NULL DEFAULT 'revisar',detail TEXT NOT NULL DEFAULT '',source_line TEXT NOT NULL DEFAULT '',completed INTEGER NOT NULL DEFAULT 0,image_path TEXT NOT NULL DEFAULT '',image_confirmed INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE images(path TEXT PRIMARY KEY,stem TEXT NOT NULL);
        CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        INSERT INTO batches (id,name,source) VALUES (42,'Antigo','cardapio.xls');
        INSERT INTO products(id,batch_id,category,original_name,name,price_cents,status,completed) VALUES(19,42,'BEBIDAS','COCA','COCA.',875,'reconhecido',1);
    ''')
    con.commit();con.close()
    store=Store(path)
    assert store.by_id(19)['completed']==1
    store.replace_addons(19,[('LIMÃO',200)])
    assert store.addons(19)[0]['name']=='LIMÃO'
    store.close()


def test_import_addons_only_when_explicitly_in_product_row(tmp_path):
    from soldelivery.importers import rows_to_products
    rows=[
        ('Produto','Preço','Categoria','Acréscimos'),
        ('X-BACON',25.00,'LANCHES','CHEDDAR R$ 3,00; BACON R$ 5,00'),
        ('REFRI COCA COLA 600ML',8.75,'BEBIDAS',''),
        ('PORÇÃO DE FRITAS',20.0,'PORÇÕES','MOLHO ESPECIAL'),
    ]
    products=rows_to_products(rows)
    assert len(products)==3
    assert products[0].addons==[('CHEDDAR',300),('BACON',500)]
    assert products[0].status=='reconhecido'
    assert products[1].addons==[]
    assert products[2].addons==[('MOLHO ESPECIAL',None)]
    assert products[2].status=='revisar'
    db=Store(tmp_path/'addons_import.db')
    bid=db.add_batch('Teste','planilha.xlsx',products)
    a,b,c=db.products(bid)
    assert len(db.addons(a['id']))==0  # ordenação por categoria: bebidas primeiro
    assert len(db.addons(b['id']))==2  # lanches
    assert len(db.addons(c['id']))==1  # porções
    db.close()


def test_changing_completed_price_returns_to_pending(tmp_path):
    db=Store(tmp_path/'precos.db')
    bid=db.add_batch('Teste','x.xls',[Extracted('ÁGUA.',500,'BEBIDAS','reconhecido')])
    row=db.products(bid)[0]
    db.mark_completed(row['id'],True)
    assert db.by_id(row['id'])['completed']==1
    db.update_price(row['id'],750)
    assert db.by_id(row['id'])['completed']==0
    db.close()
