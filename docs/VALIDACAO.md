# Validação desta organização

## Confirmado por análise de arquivos

- Os dois instaladores recebidos têm cabeçalho de executável Windows (`MZ` e PE), e seus hashes SHA-256 foram calculados sobre os arquivos enviados.
- No Sol Fiscal, o código público foi atualizado com os arquivos de código corrigidos do pacote `Sol-Fiscal-Setup-Corrigido` (`BatchPage.tsx`, `ReviewPage.tsx` e `CHANGELOG.md`). O arquivo `CORRECAO-COMPILACAO-WINDOWS.md` também foi mantido.
- As pastas `Sol-Fiscal/` e `Sol-Delivery/` e os manifestos de atualização `updates/fiscal.json` e `updates/delivery.json` estão separados.
- Os manifestos do repositório não ativam atualizações antes da publicação das Releases.
- O repositório de código não inclui executáveis ou bancos reais.

## Ainda requer teste no Windows

- Instalação e desinstalação dos dois Setups; ícones, atalhos, permissões e funcionamento do aplicativo.
- Confirmação de que os arquivos executáveis correspondem funcionalmente à versão `1.0.0` declarada nos códigos-fonte.
- Preservação de dados locais ao atualizar, teste com uma versão anterior, tratamento offline e rejeição de um hash divergente.
- Build do Sol Fiscal usando o ZIP corrigido. Build do Sol Delivery depende de gerador não recebido nesta entrega.

Validação estática não substitui homologação real e não confirma assinatura digital dos instaladores.
