# Sol Fiscal | Análise em lote a partir do Cervantes

## O problema resolvido

O PDF **Dados Fiscais de Produtos** lista os produtos mas pode deixar NCM e CEST vazios.
O leitor anterior dependia do NCM para reconhecer linhas; por isso não encontrava a tabela, mesmo com Código e Produto preenchidos.

A leitura agora utiliza coordenadas das colunas, preserva o código interno, une nomes quebrados em várias linhas, ignora as colunas ICMS/PIS/COFINS e aceita páginas seguintes sem cabeçalho. O teste do relatório de cinco páginas retornou 132 produtos sem duplicatas.

## Uso no Windows

1. Abra **Atualizações** e clique **Baixar NCM oficial (Classif)** uma vez com internet. Isso carrega as descrições de milhares de códigos no cache SQLite do Sol Fiscal. Alternativamente, baixe o JSON/XLSX do Classif e use **Importar tabela NCM**.
2. Abra **Análise em lote > Completa > Importar lista** e selecione diretamente o PDF Cervantes (não precisa converter para Excel).
3. Confira os resultados. Em produtos sem NCM, a coluna mostra **NCM sugerido, revisar** quando existem candidatos; clique no produto para ver outras possibilidades.
4. Confirme o NCM após consultar descrição, composição, nota de compra e regras legais. Use o botão **Usar após conferência**; o Sol recalcula CST IBS/CBS e cClassTrib pelo catálogo local.
5. Confira opções de CEST. O NCM/SH isolado não prova incidência de ICMS-ST. Se pertinente, clique **Usar após conferência** no CEST.
6. **Excel…** exporta as abas `Cervantes` (formato antigo compatível), `Fiscal Completo` (NCM, CEST, CST IBS/CBS e cClassTrib), `Auditoria Sol`, `Sugestões NCM` (candidatos não confirmados) e `Informações`.

A importação preserva o relatório original; nenhuma alteração é gravada no ERP ou na base do Cervantes. As sugestões em branco ou pendentes exigem revisão e **não** devem ser aplicadas em produção como se fossem homologadas.

## Base oficial NCM

Fonte da Receita Federal/Portal Único Classif:

https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json

Documentação oficial:
https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/classificacao-fiscal-de-mercadorias/download-ncm-nomenclatura-comum-do-mercosul

O aplicativo só ativa dados NCM com ao menos 8.000 códigos de oito dígitos com descrição. Atualizações inválidas mantêm a versão em SQLite.

## Limitações explícitas

- Ter uma descrição semelhante não prova que o NCM seja correto. Ex.: o mesmo nome "empada de frango" pode exigir composição e proporção da carne para decidir entre capítulos 16 e 19.
- Só a classificação validada de NCM permite executar o motor IBS/CBS. Regras cClassTrib não são inferidas de nome isolado.
- PDFs inteiramente escaneados ainda precisam de OCR. Outros fornecedores sem as coordenadas Cervantes seguem pelo importador genérico.
- A geração de `Sol Fiscal Setup.exe` e `Sol Fiscal Atualizacao.exe` exige ferramentas de compilação para Windows e deve ser testada no Windows.

## Testes do pacote

Execute `npm install`, depois `npm run test:core` e `npm run build` no computador de desenvolvimento. Use `GERADOR.bat` para gerar o instalador/atualização no Windows.

O teste `tests/cervantes-pdf.test.mjs` usa posições dos textos das cinco páginas, sem dados pessoais do cabeçalho. `tests/ncm-description.test.mjs` valida cenários de produto sem NCM e exige aprovação explícita do usuário antes de preencher o campo confirmado.
