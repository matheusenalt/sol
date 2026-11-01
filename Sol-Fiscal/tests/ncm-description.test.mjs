import assert from 'node:assert/strict';
import { classifyProduct } from '../.core-test/engine.js';
import { buildBatchWorkItem, applyManualFiscalEdit } from '../.core-test/batch-engine.js';

const valid = ['22011000', '22021000', '16023230', '19059090', '22030000'];
const ctx = {
  ncm: [
    { codigo:'22011000', descricao:'Águas minerais e águas gaseificadas sem açúcar ou aromatizantes' },
    { codigo:'22021000', descricao:'Águas gaseificadas adoçadas ou aromatizadas' },
    { codigo:'16023230', descricao:'Preparações de carnes de aves' },
    { codigo:'19059090', descricao:'Outros produtos de padaria e pastelaria' },
    { codigo:'22030000', descricao:'Cervejas de malte' },
  ], cest:[], classtrib:[], rules:[],
  fiscalCatalog:{id:'teste',date:'2026-10-28',official:valid,special:{},options:{}},
};
for(const [description, code] of [['ÁGUA COM GÁS','22011000'],['EMPADA DE FRANGO','16023230'],['AMSTEL 600 ML','22030000']]) {
  const result = classifyProduct(ctx, {codigo:'1',descricao:description,ncm:''});
  assert.equal(result.status,'revisão',`O NCM de ${description} não pode ser aprovado sem conferência`);
  assert.equal(result.resolved.ncm,null, `Não preencher NCM confirmado de ${description} automaticamente`);
  assert.equal(result.candidates.ncm[0]?.code, code, `Deve sugerir ${code} a ${description}`);
  const item = buildBatchWorkItem(ctx,{__row:1,codigo:'1',descricao:description,ncm:''},'teste');
  assert.equal(item.applied,false,'Não registrar sugestão como alteração aplicada');
  assert.equal(item.row.ncm,'','NCM sugerido só aparece na auditoria');
  const accepted = applyManualFiscalEdit(ctx,item,{ncm:code,cst:'',cClassTrib:''});
  assert.equal(accepted.row.ncm,code,'Código confirmado passa para resultado');
}
console.log('Busca NCM por descrição / confirmação manual: OK');
