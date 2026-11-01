import sqlite3
import pytest
from soldelivery.core import normalize_name, price_to_cents, cents_to_brl, similarity, parse_lines
from soldelivery.store import Store
from soldelivery.audit import parse_public_html, compare


def test_normalization_and_currency():
    assert normalize_name("  coca   cola 600ml   ") == "COCA COLA 600ML."
    assert normalize_name("REFRI PEPSI.",False)=="REFRI PEPSI"
    assert price_to_cents("R$ 1.234,56")==123456
    assert price_to_cents("8,75")==875
    assert price_to_cents(8.75)==875
    assert price_to_cents("nao sei") is None
    assert cents_to_brl(875)=="R$ 8,75"
    assert cents_to_brl(875,False)=="8,75"


def test_image_similarity_conservative():
    assert similarity("REFRIGERANTE COCA COLA 600ML", "COCA COLA 600 ML") >= 85
    assert similarity("REFRIGERANTE COCA COLA 600ML", "COCA COLA 2L") == 0
    assert similarity("COCA COLA ZERO 600ML", "COCA COLA 600ML") == 0


def test_conservative_ocr_rows():
    data=parse_lines("REFRI COCA COLA 600ML R$ 8,75\nREFRI FANTA 2L R$ 15,00\nBATATA FRITA",conservative=True)
    assert data[0].name=="REFRI COCA COLA 600ML."
    assert data[0].price_cents==875
    assert data[0].status=="revisar"
    assert any(p.name=="BATATA FRITA." and p.price_cents is None for p in data)


def test_store_persistence(tmp_path):
    from soldelivery.core import Extracted
    p=str(tmp_path/"sol.db")
    a=Store(p)
    bid=a.add_batch("Teste","teste.xlsx",[
        Extracted("REFRI COCA 600ML.",875,"BEBIDAS","reconhecido"),
        Extracted("BATATA FRITA.",None,"PORÇÕES","revisar")])
    rows=a.products(bid)
    assert len(rows)==2
    with pytest.raises(ValueError):a.mark_completed(rows[0]["id"] if rows[0]["status"]=="revisar" else rows[1]["id"],True)
    approved=next(r for r in rows if r["status"]=="reconhecido")
    a.mark_completed(approved["id"],True)
    a.close()
    b=Store(p)
    assert b.by_id(approved["id"])["completed"]==1
    b.close()


def test_parse_public_catalog_comparison():
    html='''<html><a href="/categoria/922">BEBIDAS</a>
      <a href="/produto/1">REFRI COCA COLA 600ML. Por apenas R$ 8,75 Comprar</a>
      <a href="/produto/2">REFRI SUKITA 200 ML. R$: 2,75</a>
      <a href="/produto/3">MACARRÃO NA CHAPA. VER OPÇÕES</a></html>'''
    online,cats=parse_public_html(html,"https://example.com/","BEBIDAS")
    assert len(online)==3
    assert len(cats)==1
    assert online[0].price_cents==875
    db=Store(":memory:")
    from soldelivery.core import Extracted
    bid=db.add_batch("Teste","",[Extracted("REFRI COCA COLA 600ML.",875,"BEBIDAS","reconhecido")])
    report=compare(db.products(bid),online)
    assert report[0]["status"]=="correto"
    db.close()


def test_tabular_import():
    from soldelivery.importers import rows_to_products
    rows=[("Código","Descrição","Preço de venda","Categoria"),
          (101,"Coca-Cola 600ml",8.75,"BEBIDAS"),
          (102,"Fritas", "", "PORÇÕES")]
    result=rows_to_products(rows)
    assert len(result)==2
    assert result[0].price_cents==875
    assert result[0].status=="reconhecido"
    assert result[1].price_cents is None
    assert result[1].status=="revisar"
