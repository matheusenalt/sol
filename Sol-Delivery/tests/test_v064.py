"""0.6.4: comparar PDFs em revisão sem tomar o resultado por confirmação."""
from soldelivery.audit import compare, OnlineProduct


def item(name='REFRI COCA COLA 600ML.', price=875, status='revisar', id=1):
    return {'name':name,'price_cents':price,'status':status,'id':id}


def online(name='REFRI COCA COLA 600ML', price=875):
    return OnlineProduct(name,price,'BEBIDAS','https://exemplo.com/produto/1')


def test_pdf_pending_still_compared_but_not_automatically_approved():
    result=compare([item()],[online()])[0]
    assert result['status']=='revisar'
    assert result['match_kind']=='preco_igual'
    assert result['online_price']==875
    assert result['online_name']=='REFRI COCA COLA 600ML'
    assert not result['source_reviewed']


def test_recognized_matching_item_can_be_confirmed():
    result=compare([item(status='reconhecido')],[online()])[0]
    assert result['status']=='correto'
    assert result['match_kind']=='preco_igual'


def test_pending_price_difference_stays_manual_but_visible():
    result=compare([item()],[online(price=899)])[0]
    assert result['status']=='revisar'
    assert result['match_kind']=='preco_diferente'
    assert result['online_price']==899


def test_pending_without_site_match_explained_not_claimed_as_missing():
    result=compare([item(name='PRODUTO ORIGINAL XYZ')],[online()])[0]
    assert result['status']=='revisar'
    assert result['match_kind']=='sem_correspondencia'


def test_different_labels_allow_suggestion_but_not_confirmation():
    result=compare([item(name='REFRI COCA COLA 600ML SEM ACUCAR')],[online()])[0]
    assert result['status'] != 'correto'
    assert result['match_kind'] in {'nome_parecido','sem_correspondencia'}


def test_many_pending_products_no_longer_collapse_into_uninformative_review_count():
    rows=[item(name=f'PRODUTO TESTE {i} 600ML.',id=i) for i in range(210)]
    online_rows=[OnlineProduct(f'PRODUTO TESTE {i} 600ML',500,'TESTE',f'https://exemplo.com/p/{i}') for i in range(223)]
    result=compare(rows,online_rows)
    assert len(result)==210
    assert sum(r['match_kind']=='preco_diferente' for r in result)==210
    assert all(r['status']=='revisar' for r in result)
