"""0.6.5: sincronizar somente itens da lista por nome/preço únicos no site."""
import sqlite3
import pytest
from soldelivery import audit
from soldelivery.core import Extracted
from soldelivery.store import Store


def op(name,price,number):
    return audit.OnlineProduct(name,price,'QUALQUER',f'https://loja.exemplo/p/{number}')


def make_store(tmp_path):
    s=Store(tmp_path/'db.sqlite')
    idb=s.add_batch('Bebidas','bebidas.pdf',[
        Extracted('REFRI COCA COLA 600ML.',875,'BEBIDAS','revisar'),
        Extracted('REFRI PEPSI 2L.',1450,'BEBIDAS','revisar'),
        Extracted('REFRI FANTA LARANJA 350ML.',550,'BEBIDAS','revisar'),
    ])
    return s,idb


def test_site_only_list_matches_auto_complete_and_others_ignored(tmp_path):
    s,b=make_store(tmp_path)
    online=[op('REFRI COCA COLA 600ML',875,1),op('REFRI PEPSI 2L',1390,2),
            op('X-BACON',2250,3),op('PIZZA QUEIJO',4200,4)]
    rows=s.products(b)
    comparison=audit.compare(rows,online)
    assert audit.audit_counts(comparison)=={'correto':1,'preco_diferente':1,'nao_localizado':1}
    result=s.synchronize_site(b,comparison)
    assert result=={'matched':1,'newly_completed':1,'reopened':0}
    assert len(online)==4
    cola=next(r for r in s.products(b) if 'COCA' in r['name'])
    assert cola['completed']==1 and cola['completion_source']=='site'
    assert cola['status']=='revisar'  # origem preservada, confirmação é de publicação
    assert s.batch_counts(b)['review']==2  # não exige revisão manual do confirmado
    s.close()


def test_recheck_does_not_repeat_and_reopens_only_old_site_matches(tmp_path):
    s,b=make_store(tmp_path)
    rows=s.products(b)
    manual=next(r for r in rows if 'FANTA' in r['name'])
    s.update_product(manual['id'],manual['name'],manual['price_cents'],'BEBIDAS',confirmed=True)
    s.mark_completed(manual['id'],True)
    online=[op('REFRI COCA COLA 600ML',875,1),op('REFRI PEPSI 2L',1450,2),op('REFRI FANTA LARANJA 350ML',550,3)]
    compare=audit.compare(s.products(b),online)
    assert s.synchronize_site(b,compare)['newly_completed']==2
    assert s.synchronize_site(b,compare)['newly_completed']==0
    changed=[op('REFRI COCA COLA 600ML',999,1),op('REFRI FANTA LARANJA 350ML',550,3)]
    result=s.synchronize_site(b,audit.compare(s.products(b),changed))
    assert result['reopened']==2  # antes confirmados somente pela auditoria
    by_name={r['name']:r for r in s.products(b)}
    assert by_name['REFRI FANTA LARANJA 350ML.']['completed']==1
    assert by_name['REFRI FANTA LARANJA 350ML.']['completion_source']=='manual'
    assert by_name['REFRI COCA COLA 600ML.']['completed']==0
    s.close()


def test_similar_name_or_different_package_must_not_auto_complete(tmp_path):
    s,b=make_store(tmp_path)
    site=[op('COCA COLA 600ML',875,1),op('REFRI PEPSI 2L ZERO',1450,2)]
    result=audit.compare(s.products(b),site)
    assert audit.audit_counts(result)['correto']==0
    assert s.synchronize_site(b,result)['matched']==0
    s.close()


def test_duplicate_names_on_both_sides_not_accepted(tmp_path):
    s=Store(tmp_path/'db.sqlite')
    b=s.add_batch('D','pdf',[
        Extracted('X-BACON',2250,'L','reconhecido'),
        Extracted('X-BACON',2250,'L','reconhecido')])
    online=[op('X-BACON',2250,1)]
    result=audit.compare(s.products(b),online)
    assert [x['match_kind'] for x in result]==['duplicados','duplicados']
    assert s.synchronize_site(b,result)['matched']==0
    s.close()


def test_online_duplicates_do_not_accept_arbitrarily(tmp_path):
    s,b=make_store(tmp_path)
    online=[op('REFRI COCA COLA 600ML',875,1),op('REFRI COCA COLA 600ML',875,2)]
    result=audit.compare(s.products(b),online)
    assert result[0]['match_kind']=='duplicados'
    assert s.synchronize_site(b,result)['matched']==0
    s.close()


def test_bogus_results_cannot_update_other_batch(tmp_path):
    s,b=make_store(tmp_path)
    other=s.add_batch('Outras','', [Extracted('X-BACON',100,'L','reconhecido')])
    results=audit.compare(s.products(other),[op('X-BACON',100,7)])
    with pytest.raises(ValueError,match='não corresponde à lista completa'):
        s.synchronize_site(b,results)
    assert s.batch_counts(other)['completed']==0
    s.close()


def test_older_db_migrates_without_losing_progress(tmp_path):
    db=tmp_path/'db.sqlite'
    s,b=make_store(tmp_path)
    # Simula colunas da versão anterior, sem o metadado.
    s.close()
    con=sqlite3.connect(db)
    con.execute('ALTER TABLE products DROP COLUMN completion_source')
    con.commit();con.close()
    s=Store(db)
    assert s.by_id(s.products(b)[0]['id'])['completion_source']==''
    assert len(s.products(b))==3
    s.close()


def test_change_price_reopens_auto_completed_product(tmp_path):
    s,b=make_store(tmp_path)
    c=audit.compare(s.products(b),[op('REFRI COCA COLA 600ML',875,1)])
    s.synchronize_site(b,c)
    row=next(r for r in s.products(b) if 'COCA' in r['name'])
    s.update_price(row['id'],999)
    updated=s.by_id(row['id'])
    assert updated['completed']==0 and updated['completion_source']==''
    s.close()


def test_already_site_completed_can_advance_without_source_review(tmp_path):
    s,b=make_store(tmp_path)
    result=audit.compare(s.products(b),[op('REFRI COCA COLA 600ML',875,1)])
    s.synchronize_site(b,result)
    cola=next(x for x in s.products(b) if 'COCA' in x['name'])
    s.mark_completed(cola['id'],True)  # idempotente para o Mini
    assert s.by_id(cola['id'])['completed']==1
    s.close()
