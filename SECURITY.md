# Segurança do projeto Sol

## Antes de publicar

Nunca inclua dados reais de clientes, relatórios fiscais, notas, dados pessoais, senhas, tokens, certificados ou bancos SQLite no repositório. Revise também os arquivos excluídos pelo `.gitignore`, pois itens já versionados não são removidos automaticamente.

## Atualizações

Os manifestos de versão ficam em `updates/`. Mantenha `enabled: false` (Fiscal) e `published: false` (Delivery) até os instaladores terem sido anexados às Releases públicas corretas, com seus hashes SHA-256 confirmados e testes em Windows.

Validação por hash detecta alterações acidentais ou discrepâncias, mas **não substitui uma assinatura digital de código**. Antes de executar instaladores, o usuário deve conferi-los e confiar na origem.

## Comunicação de falhas

Reporte problemas de segurança de forma privada ao responsável pelo repositório; evite publicar detalhes sensíveis, segredos ou dados de terceiros em issues públicas.
