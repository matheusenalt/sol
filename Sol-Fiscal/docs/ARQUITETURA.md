# Arquitetura — Sol Fiscal

## Prioridade de produto

O **cClassTrib** é o fluxo principal. NCM, CEST e CNPJ são utilitários auxiliares. O objetivo operacional é receber produtos, resolver automaticamente o que for determinístico e concentrar trabalho humano apenas em escolhas contextuais e correções de NCM.

## Sol Core

O núcleo permanece independente de ERP e usa o mesmo princípio operacional do catálogo do GL Reforma Fiscal:

```text
Produto + NCM (+ CST/cClassTrib existentes, quando houver)
   ↓
validar NCM oficial
   ↓
catálogo fiscal local
   ├─ NCM sem exceção → padrão operacional 000/000001 → RESOLVIDO com confiança média
   ├─ NCM especial com 1 regra → combinação específica → RESOLVIDO
   ├─ NCM contextual + classificação existente válida → RESOLVIDO
   ├─ NCM contextual sem decisão → alternativas → REVISÃO
   └─ NCM inválido/ausente → correção de NCM → REVISÃO
```

CEST não participa desse motor.

## Catálogo local

Snapshot atual:

- 10.515 NCMs oficiais;
- 1.573 NCMs especiais;
- 10.194 NCMs resolvidos automaticamente;
- 321 NCMs contextuais com alternativas e revisão.

O catálogo do Sol usa uma estrutura operacional própria. Ele não é apresentado como uma tabela oficial direta NCM → cClassTrib. Para NCM sem tratamento especial identificado, o padrão 000/000001 é marcado com confiança média e aviso de que contexto da operação, destinatário ou benefício pode exigir outro enquadramento.

## Importação

Formatos aceitos:

- PDF com texto pesquisável;
- XLSX/XLS;
- CSV;
- TXT.

### PDF

`pdfjs-dist` extrai os itens de texto localmente. O parser reconstrói linhas pelas coordenadas do PDF, procura uma coluna NCM quando existe cabeçalho e possui fallback para linhas livres contendo NCM de 8 dígitos.

PDF escaneado sem camada de texto não é classificado silenciosamente: o usuário recebe orientação para OCR/XLSX/CSV.

## Revisão cClassTrib

Cada NCM contextual expõe todas as alternativas cadastradas com:

- CST IBS/CBS;
- cClassTrib;
- rótulo;
- fundamento;
- anexo;
- redução, quando disponível.

A decisão pode ser aplicada a um produto ou explicitamente a todos os itens em revisão com o mesmo NCM. Uma classificação manual fora do catálogo exige confirmação e coerência entre os 3 dígitos do CST e o prefixo do cClassTrib.

## Persistência e exportação

O workspace e o histórico permanecem em SQLite/local storage conforme o ambiente. Exportação: XLSX, CSV e PDF.

## Auditoria fiscal em lote

A Análise em lote reutiliza o Sol Core, mas acrescenta uma camada de diagnóstico por escopo:

```text
arquivo PDF/XLSX/CSV/TXT
  → identificar empresa
  → normalizar itens
  → validar NCM
  → cruzar CEST por NCM/SH
  → calcular/comparar CST + cClassTrib
  → divergência ou múltiplas alternativas = revisão
```

O usuário pode limitar a auditoria a NCM, CEST ou IBS/CBS. O diagnóstico do modo escolhido não deve ser contaminado por pendências de outro módulo. CEST é tratado como compatibilidade cadastral, nunca como prova automática de incidência de ICMS-ST.

Para NCMs contextuais, o motor usa a descrição do produto somente para **ordenar** alternativas por compatibilidade. Esse ranking não transforma uma hipótese em decisão automática. Sem descrição, as opções continuam disponíveis com confiança moderada e sem compatibilidade semântica calculada.

A consulta cClassTrib embarcada é um recorte operacional. A tela Atualizações já aceita um override local validado da tabela oficial em XLS/XLSX/CSV/JSON, com deduplicação, coerência CST/prefixo e SHA-256. O override é mesclado apenas com as combinações operacionais necessárias ao catálogo, pode ser restaurado para a base embarcada e não altera snapshots já finalizados. A sincronização automática futura deve preservar o mesmo contrato de segurança.

## ERP

O Sol Fiscal não escreve em ERP na base atual. Conectores futuros deverão respeitar:

`detectar → conectar → ler → validar → backup → aplicar → verificar → rollback/auditoria`.

## Ciclo de vida da empresa

Cada importação/cadastro pertence a uma `analysis_session` isolada por empresa.

Estados:

```text
em_configuracao
      ↓
revisão / correções
      ↓
finalizar (somente se NCM + CST + cClassTrib estiverem completos)
      ↓
pronto (somente leitura)
```

Uma sessão `pronto`:

- não pode ser atualizada pelo comando normal de persistência;
- não pode ter a empresa renomeada;
- permite exportação;
- pode ser visualizada pelo Histórico sem liberar edição;
- só volta para edição pelo comando explícito `reopen_session` acionado no Histórico.

A tabela `analysis_sessions` guarda `status` e `finalized_at`. O schema atual é 6 e migra lotes anteriores para `em_configuracao`.

### Snapshot fiscal imutável

O `payload` de uma sessão passa a persistir também o `FiscalResult` calculado por item, incluindo `engineVersion` e `sources`. Isso desacopla auditoria histórica da base instalada no futuro.

```text
salvar lote
  → persistir row + result + origem da base
  → atualizar base do aplicativo no futuro
  → abrir lote antigo
  → usar result persistido (sem recálculo)
```

Lotes legados sem `result` têm dois comportamentos controlados:

- visualização de `pronto`: congela NCM/CST/cClassTrib já gravados, sem chamar o motor atual;
- lote editável legado: pode ser calculado pela base atual, e após a primeira persistência ganha snapshot completo.

Ao executar **Reabrir para editar** em um lote legado `pronto`, o frontend captura o snapshot congelado antes de o backend remover o status de bloqueio. A reanálise com a base atual exige ação explícita do operador.


## Atualização leve do aplicativo

O gerador Windows pode produzir `release\Sol Fiscal Atualizacao.exe` usando `tauri build --no-bundle`. Esse artefato é separado do Setup NSIS e serve apenas para uma instalação existente. O atualizador é um executável C# autocontido gerado no build, com o novo `Sol Fiscal.exe` comprimido como recurso interno. Na execução ele detecta a instalação existente, valida SHA-256 do payload, solicita confirmação, fecha o app quando necessário, aplica a troca com backup/rollback, solicita UAC somente se a pasta não for gravável e reabre o Sol. Não há ZIP, extração manual ou BAT para o usuário.

Contrato de segurança do atualizador:

- localizar a instalação por processo, Registro do Windows ou caminhos comuns;
- validar SHA-256 do payload antes da troca;
- fechar somente o processo da instalação localizada;
- criar `.bak` do executável anterior;
- substituir somente o executável e validar novamente o hash;
- restaurar o backup se a troca falhar;
- não tocar no diretório de dados do Tauri/SQLite;
- elevar privilégio somente quando o diretório de instalação exigir.

Esse mecanismo reduz o tamanho de distribuição porque não reempacota o instalador offline do WebView nem os componentes do Setup. A primeira instalação continua sendo feita pelo NSIS.
