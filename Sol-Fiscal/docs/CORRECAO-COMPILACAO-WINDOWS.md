# Correção da compilação Windows (30/10/2026)

## Sintomas

Durante `npm run desktop:build`, o frontend falhava em `tsc && vite build` com:

- `BatchPage.tsx`: TS7022 e TS2448, devido ao sombreamento do nome `needsReview`.
- `ReviewPage.tsx`: TS2345, por possível `undefined` no parâmetro NCM de `findCestForNcm`.

## Correções

- `BatchPage.tsx` usa `reviewRequired` como variável local e preserva o campo público `needsReview` no resultado.
- `ReviewPage.tsx` passa string vazia quando o NCM ainda não está preenchido; a consulta de CEST só é executada se o item já tem NCM resolvido.

Nenhuma classificação fiscal foi alterada por este ajuste.

## Como testar

1. Extraia o ZIP de Setup corrigido em uma **nova pasta** (não misture com a anterior).
2. Execute `Sol-Fiscal/GERADOR.bat`. Não é preciso reinstalar Node, Rust ou Microsoft C++ Build Tools se o gerador já os detecta.
3. Execute os testes e a compilação pelo gerador. Alternativamente, na pasta `Sol-Fiscal`, execute:

   ```powershell
   npm install --no-audit --no-fund
   npm run test:core
   npm run build
   npm run desktop:build
   ```

4. Confirme a geração do instalador NSIS, instale numa máquina/VM de testes e abra a interface.
5. Confira Análise em lote e Revisão, incluindo PDF sem NCM, sugestão de NCM, escolha de CEST, exportação e manutenção dos dados anteriores.

Se houver novo erro, compartilhe o **novo log completo do gerador**. Esta entrega não foi compilada em ambiente Windows nesta sessão.
