# Publicação dos instaladores — GitHub Releases

Repositório: https://github.com/matheusenalt/sol

**Importante:** os instaladores `.exe` **não** pertencem ao Git versionado. Faça o upload de cada um como **asset de sua própria Release** no GitHub. Os manifestos de `updates/` estão inicialmente desativados para evitar atualizações prematuras.

## Release 1 — Sol Fiscal

- Tag exata: `fiscal-v1.0.0`
- Título sugerido: `Sol Fiscal v1.0.0`
- Anexo exato: `Sol-Fiscal-Setup-1.0.0.exe`
- Tamanho: `224,694,140` bytes
- SHA-256: `6a80454c34da9b11120325e22ff94c0848e0c1acc5735eb5a10912861d033756`
- URL de publicação: https://github.com/matheusenalt/sol/releases/new

1. Use o instalador renomeado `Sol-Fiscal-Setup-1.0.0.exe` (o conteúdo é idêntico ao arquivo `Sol Fiscal Setup.exe` recebido).
2. Crie uma Release com a tag `fiscal-v1.0.0` na branch que contém o código-fonte correspondente, anexando esse arquivo.
3. Não marque a Release como Draft ou Pre-release na publicação final.
4. Depois de homologar, atualize o arquivo `updates/fiscal.json` usando o **manifesto candidato** em `manifestos-apos-publicar/fiscal.json` do kit de publicação, marcando `enabled: true` apenas após confirmar o hash do asset remoto.

## Release 2 — Sol Delivery

- Tag exata: `delivery-v1.0.0`
- Título sugerido: `Sol Delivery v1.0.0`
- Anexo exato: `Sol Delivery Setup.exe` (incluindo espaços e maiúsculas)
- Tamanho: `110,119,829` bytes
- SHA-256: `ae2aff42ba5dc63f3fc305e66fb1d2364d864d1d3eac0078b5da65f6281873cb`
- URL de publicação: https://github.com/matheusenalt/sol/releases/new

1. Crie uma Release separada com tag `delivery-v1.0.0`.
2. Anexe o arquivo `Sol Delivery Setup.exe` **sem renomeá-lo**; o atualizador espera exatamente esse nome.
3. Após teste e publicação, copie o manifesto candidato `manifestos-apos-publicar/delivery.json` sobre `updates/delivery.json` e confirme `published: true`.

## Sequência correta

1. Publicar **o código-fonte do repositório** no GitHub (sem os executáveis).
2. Testar ambos os Setups no Windows com dados fictícios e conferir as versões instaladas; o arquivo PE sozinho não comprova a execução.
3. Criar **duas Releases independentes**; cada uma recebe apenas seu respectivo `.exe`.
4. Conferir os downloads remotos e SHA-256 antes de ativar os dois manifestos de atualização.
5. Fazer commit dos manifestos ativados; testar atualização com uma versão mais antiga.

## Verificação de hash no Windows

```powershell
Get-FileHash -Algorithm SHA256 '.\Sol-Fiscal-Setup-1.0.0.exe'
Get-FileHash -Algorithm SHA256 '.\Sol Delivery Setup.exe'
```

Se os hashes publicados não corresponderem aos listados neste documento, **não habilite** os manifestos: corrija a Release ou gere manifests com os hashes dos instaladores efetivamente validados.

## Observações

- O instalador Fiscal foi fornecido junto do pacote **Sol-Fiscal-Setup-Corrigido**; as correções de código `BatchPage.tsx` e `ReviewPage.tsx` foram copiadas para a fonte pública.
- O gerador do Sol Delivery não foi enviado; esta entrega contempla o instalador executável recebido e o código-fonte público. Não há workflow de build para o Delivery neste pacote.
- Uma Release v1.0.0 não aparece como atualização para quem já tem a versão 1.0.0. Para testar atualização ponta a ponta, use uma versão anterior em VM.
- Os dois binários foram inspecionados de forma estática; os testes de instalação, inicialização e atualização no Windows permanecem pendentes.
