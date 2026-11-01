# Publicação e atualizações: Sol Fiscal

O repositório de monorepo é `matheusenalt/sol`. O aplicativo reside em `Sol-Fiscal/`. O arquivo de controle da versão é **`updates/fiscal.json` na raiz**. Sol Delivery deverá ter seu próprio manifesto, seus próprios assets e tags, sem compartilhar a versão instalada.

## Primeira publicação (sem publicar automaticamente)

1. Extraia **Sol-Fiscal-Codigo.zip** na raiz do clone `https://github.com/matheusenalt/sol.git`, preservando `Sol-Fiscal/`, `updates/` e `README.md`. Revise diffs, possíveis segredos e o histórico antes de `git add`, `git commit` e `git push`.
2. No Windows x64, extraia **Sol-Fiscal-Setup.zip** em uma pasta de build separada. Execute `Sol-Fiscal/GERADOR.bat` → **Gerar instalador**. Dependências de compilação: Node.js LTS, Rust MSVC, Visual Studio C++ Build Tools, WebView2 e NSIS/Tauri; o gerador existente ajuda a prepará-las. Usuário final **não** precisa dessas ferramentas.
3. O build gera `release/Sol Fiscal Setup.exe`, `release/Sol-Fiscal-Setup-1.0.0.exe` e `release/updates/fiscal.json` (se o script `prepare-release.ps1` foi executado). O script calcula o SHA-256 sobre o EXE real. Verifique `Get-FileHash` e faça teste de instalação e de atualização em máquina virtual Windows.
4. No GitHub, crie uma Release pública de produção com a tag EXATA `fiscal-v1.0.0` e anexe o asset EXATO `Sol-Fiscal-Setup-1.0.0.exe`. **Não** marque como Draft ou Pre-release.
5. Somente depois de o asset estar publicado, substitua `updates/fiscal.json` da raiz pelo arquivo `release/updates/fiscal.json` gerado com `enabled=true`; confirme o hash publicado e faça commit desse manifesto. Antes disso o manifesto inicial vem com `enabled=false` de propósito.
6. Confirme a atualização em um PC de QA com versão inferior. O download segue a URL do asset da Release, valida tamanho e SHA-256, fecha o app após consentimento, inicia o instalador NSIS e tenta reabrir o executável após uma instalação bem-sucedida.

## Próximas versões

- Altere **todas** as versões: `Sol-Fiscal/package.json`, `Sol-Fiscal/src-tauri/Cargo.toml`, `Sol-Fiscal/src-tauri/tauri.conf.json`; use `X.Y.Z` maior, atualize `CHANGELOG.md` e gere novo instalador.
- Repita processo de tag `fiscal-vX.Y.Z`, asset `Sol-Fiscal-Setup-X.Y.Z.exe` e manifesto hash novo. Publique a Release antes de ativar o manifesto; nunca inclua arquivos de Sol Delivery na Release do Fiscal.
- Teste upgrades com dados existentes. **Não** altere o `identifier = br.com.solfiscal.desktop` entre versões: ele define a pasta dos dados persistentes do Tauri/SQLite.

## Como funciona

- Na abertura, o frontend consulta no máximo uma vez por intervalo móvel de 24h (timestamp local) em segundo plano. A verificação manual não tem esse limite. Sem rede, o usuário continua utilizando o app.
- O backend confere `product`, `repository`, tag, formato semântico, nome do arquivo, hash e Release pública por API `https://api.github.com/repos/matheusenalt/sol/releases/tags/<tag>`; recusa tags do Delivery, Assets diferentes, Releases rascunho e downgrades.
- O instalador só inicia após nova consulta, novo download, hash SHA-256 e confirmação explícita. Baixa num cache separado e usa script local de espera pela saída do app, evitando a condição de corrida de arquivo em uso do NSIS.
- SHA-256 garante que os bytes recebidos coincidam com os publicados no manifesto; **não substitui assinatura de código Authenticode**, auditoria de dependências ou proteção contra comprometimento do próprio repositório/conta GitHub. Recomenda-se assinatura e proteção por 2FA para releases de produção.
- Um build com app portátil/instalação legada precisa de teste de migração para NSIS; a instalação é `currentUser`. Não migra nem apaga bancos de dados.

## Cuidados antes de liberar

- GitHub Releases têm limites de taxa; a UI é tolerante a falhas. O usuário pode usar atualização manual no menu.
- O instalador offline WebView2 pode ser grande; a validação impõe limite de 350 MiB. Se seu build exceder esse valor, revise a estratégia ou aumente limite com justificativa e testes.
- Execute os testes e compile no Windows. **Este pacote por si só não contém instalador compilado.**
