# Sol Fiscal

## Correção de compilação — 30/10/2026

- Corrigido o conflito entre a variável local de auditoria e a função `needsReview` na tela de Análise em lote (TS7022/TS2448).
- Corrigida a passagem de NCM opcional à busca de CEST na tela de Revisão (TS2345).
- Sem alteração de comportamento fiscal, banco de dados, contratos de atualização ou versão de aplicativo; correção restrita à compilação do frontend.

- Corrigida a detecção do `Sol Fiscal Atualizacao.exe`: agora procura o app por processo em execução, marcador próprio em HKCU, registro de desinstalação, App Paths, pastas padrão e cópia portátil ao lado do atualizador; selecionar `Sol Fiscal Setup.exe` passa a exibir orientação clara em vez de falhar genericamente.
- O próprio app passa a gravar `HKCU\Software\Sol Fiscal\InstallPath` ao abrir, tornando as próximas atualizações mais confiáveis sem exigir administrador.
- Corrigido o launcher do GERADOR no Windows: removida a elevação administrativa na abertura, adicionado launcher silencioso via WScript e log de inicialização/erro (`logs\gerador-startup.log`).

## Em desenvolvimento — snapshot fiscal e auditoria

- **Gerar atualização** agora produz um único `Sol Fiscal Atualizacao.exe`: sem ZIP, extração manual ou BAT. O executável carrega o novo binário comprimido, valida SHA-256, detecta a instalação, fecha/reabre o app, mantém backup e solicita UAC apenas quando necessário, preservando banco/histórico/configurações.
- Resultados resolvidos da análise em lote passam a usar o selo verde **resolvido**; a busca NCM exibe selos de vigência e destaca códigos inativos/futuros.
- Consulta de NCM inativo passa a tentar localizar candidatos vigentes por descrição; no lote, NCM não vigente/não localizado exibe candidatos da base vigente para revisão humana.
- O resultado do Sol Core passa a ser persistido dentro do snapshot de cada item do lote.
- Abrir uma empresa salva ou `Pronto` não recalcula mais silenciosamente CST/cClassTrib com a base instalada atualmente.
- Lotes legados finalizados preservam os campos fiscais gravados antes de serem reabertos para edição.
- Reanálise com uma base diferente passa a ser ação explícita, com confirmação, persistência e registro no Histórico.
- Tela de empresa `Pronto` mostra a base do snapshot realmente usada no lote, em vez da base atual do aplicativo.
- Excel de auditoria ganhou colunas de motor e base fiscal; PDF e aba Informações também exibem a base do snapshot.
- Finalização no backend rejeita NCM `00000000` e combinação em que o prefixo do cClassTrib não corresponde ao CST.
- Referência oficial conhecida de cClassTrib registrada como **IT 2025.002 v1.70 — 01/10/2026**.
- O padrão operacional `000/000001` para NCM sem tratamento especial deixa de ser rotulado como alta confiança: passa a confiança média com alerta de contexto operacional.
- Recorte local de contingência cClassTrib atualizado com códigos adicionais publicados na referência v1.70.
- Testes adicionados para impedir regressão do comportamento de snapshot/reanálise.

- **Análise em lote** deixa de ser somente uma visualização do lote ativo e passa a importar PDF/XLS/XLSX/CSV/TXT diretamente, com modos Completa, NCM, CEST e CST/cClassTrib.
- Auditoria em lote compara classificações existentes com o resultado calculado e marca divergências para revisão em vez de sobrescrever silenciosamente.
- Busca CEST por NCM passa a interpretar código exato, prefixos NCM/SH e expressões por capítulo, exibindo todas as opções relacionadas e compatibilidade.
- Alternativas cClassTrib contextuais passam a ser ordenadas por compatibilidade textual com a descrição do produto; sem descrição, permanecem sem ranking semântico forte.
- Cadastro manual do motor aceita NCM sem exigir nome do produto e informa que descrição é recomendada para maior confiança.
- Botões de cópia adicionados para NCM, CEST, CST IBS/CBS, cClassTrib e IE onde aplicável.
- Consulta NCM ganhou fallback por palavras significativas quando a frase inteira não retorna resultado.
- Consulta CNPJ passa a aproveitar inscrições estaduais retornadas pela fonte principal e mantém os nomes dos provedores fora da interface operacional.
- Tela de Atualizações e consulta cClassTrib deixam explícito que o recorte embarcado não é a tabela oficial completa.
- Importação controlada da tabela oficial cClassTrib em XLS/XLSX/CSV/JSON, com validação de CST/prefixo, deduplicação, SHA-256, ativação local e restauração da base embarcada.
- Excel de auditoria e PDF de análise passam a incluir CEST; PDF passa a se identificar como relatório de análise fiscal.

## 0.8.0 — empresa pronta e bloqueio de edição

- Novo ciclo de vida do lote: `Em configuração` → `Pronto`.
- Botão **Finalizar empresa** só aparece quando todos os produtos estão resolvidos.
- Validação também é feita no backend antes de finalizar: todos os itens precisam ter NCM, CST IBS/CBS e cClassTrib concluídos.
- Empresa finalizada fica em modo **somente leitura**.
- Na tela de empresa pronta, as únicas ações do lote são **Excel**, **CSV** e **PDF**.
- Revisão e Análise em lote ficam indisponíveis enquanto a empresa pronta estiver aberta.
- Histórico mostra status de cada empresa.
- Histórico permite **Ver empresa** sem liberar edição.
- Histórico permite **Reabrir para editar**, removendo o status Pronto até uma nova finalização.
- Histórico ganhou **Nova empresa** para iniciar outro cliente sem misturar lotes.
- Estado `Pronto`, data de finalização e empresa continuam persistidos no SQLite após fechar o aplicativo.
- Backend impede alterações acidentais em uma sessão finalizada.
- Banco local atualizado para schema 6 com migração automática das versões anteriores.
- Sol Core identificado como 0.8.0.

## Mantido da linha 0.7

- Motor cClassTrib como fluxo principal.
- Importação PDF/XLSX/CSV/TXT.
- Lotes isolados por empresa e deduplicação.
- Revisão de alternativas e classificação manual.
- Exportação operacional Código / Produto / NCM / cClassTrib.
- CNPJ.ws com suporte ao CNPJ alfanumérico e fallback numérico via BrasilAPI.
- Consultas auxiliares NCM, CEST e CNPJ.

## Correção da importação Cervantes e identificação NCM pela descrição — 28/10/2026

- Leitura geométrica específica do relatório **Dados Fiscais de Produtos** do Cervantes, mesmo com NCM/CEST vazios e sem cabeçalhos nas páginas seguintes; une descrições quebradas em múltiplas linhas.
- Teste com as cinco páginas do relatório de referência: **132 produtos, 132 códigos internos distintos**, sem ler CSOSN 500, CST PIS 99 ou CST COFINS 99 como dados de IBS/CBS.
- Motor de hipóteses NCM por descrição: índice lexical de tabela oficial Classif, cache local SQLite, sincronização com o endpoint oficial e importação offline do JSON/XLSX/CSV de NCM.
- O lote tenta obter as descrições da tabela NCM quando necessário. Se a rede falhar, preserva o lote e usa candidatos limitados baseados em referências condicionais conhecidas, com fila de revisão.
- **Não** atribui NCM por similaridade sem confirmação humana; código sugerido, razão e confiança aparecem na tabela e nas abas de Excel, separado do NCM confirmado.
- Botões de confirmação controlada de NCM e CEST na análise em lote. A escolha de NCM reaplica o Sol Core para calcular CST IBS/CBS e cClassTrib; CEST exige conferência de mercadoria e ICMS-ST.
- Planilha Excel passou a incluir abas **Fiscal Completo** e **Sugestões NCM**, preservando a aba Cervantes existente para compatibilidade.
- Testes de regressão com posições reais anonimizadas do PDF e dos fluxos de sugestão/aprovação.

## Correção de revisão unificada e exportação fiscal — 28/10/2026

- NCM encontrado na lista NCM embarcada/sincronizada, mas ausente do catálogo antigo de regras: deixa de ser declarado inexistente. O motor distingue **NCM reconhecido** de **regra cClassTrib pendente**; não aplica 000/000001 automaticamente quando faltar regra.
- CST e cClassTrib confirmados manualmente têm precedência sobre o padrão automático do catálogo e são preservados no lote. Confirmação manual não equivale a homologação tributária e fica identificada no histórico/alertas.
- Revisão centraliza NCM, CEST, CST IBS/CBS e cClassTrib, com resumo dos quatro campos, lista de pendências por produto, seleção de CEST compatível e decisão expressa de **CEST não aplicável** (não implica ICMS-ST).
- Fila, indicadores e finalização usam o mesmo diagnóstico; item que ainda tem CEST ou NCM pendente não é marcado pronto só porque o cClassTrib foi confirmado.
- Itens ignorados podem ser restaurados e continuam pendentes para exportação/finalização; não somem como se tivessem sido homologados.
- A exportação XLSX (aba Fiscal Completo) e CSV fiscal completo contém colunas para **campos confirmados** e **valores informados pendentes**, status e pendências. A aba operacional Cervantes continua separada e não recebe dados fiscais não confirmados.
- O backend Rust passa a exigir `pendingReview=false` no snapshot salvo, além de código e prefixo coerentes, antes de finalizar a empresa.
- Importação pela tela cClassTrib carrega também a tabela NCM em cache/online, alinhada ao fluxo de Análise em lote.
- Regressões automatizadas: NCM de referência mais recente, classificação manual persistente, CEST válido/inválido/não aplicável, snapshot e exportação parcial, mantendo o teste do PDF Cervantes de 132 produtos.
- Correção complementar: ao alterar NCM de um produto com CST/cClassTrib confirmados manualmente, o operador pode confirmar **novamente** a manutenção da classificação; caso contrário, o motor recalcula. A edição não descarta mais valores humanos sem escolha explícita.
