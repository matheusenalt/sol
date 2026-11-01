# Sol Fiscal

Aplicativo desktop Windows de suporte à revisão e organização fiscal de produtos, parte do ecossistema pessoal **Sol**. Não substitui a análise do profissional fiscal: sugestões de NCM, CEST, CST IBS/CBS e cClassTrib exigem confirmação quando incertas.

![Ícone oficial do Sol Fiscal](public/brand/sol-logo-yellow.png)

## Funcionalidades

- **cClassTrib**: classificação e revisão orientada por empresa, com status *Em configuração* ou *Pronto*.
- **NCM**: busca por código/descrição; sugestão nominal após carregar descrições da tabela oficial Classif; validação e decisão assistida.
- **CEST**: consulta por descrição/NCM e confirmação explícita quando aplicável; CEST não define automaticamente ICMS-ST.
- **CNPJ**: consulta online com cache local e suporte a CNPJ alfanumérico quando disponível nas fontes.
- **Análise em lote**: PDF com texto, XLS/XLSX, CSV e TXT, inclusive layout Cervantes com NCM/CEST vazios.
- **Revisão unificada**: NCM, CEST, CST IBS/CBS e cClassTrib, com rastreabilidade e decisões manuais.
- **Histórico**: múltiplas empresas, snapshots por lote, reabertura explícita de uma empresa finalizada.
- **Exportação**: Excel/CSV/PDF, auditoria e propostas ainda não confirmadas identificadas separadamente.
- **Bases fiscais**: atualização/importação controlada, cache offline, sem substituição automática de dados históricos.
- **Atualização do aplicativo**: GitHub Releases, verificação automática diária sem bloquear, botão manual, download íntegro via SHA-256, consentimento para instalar, atualização independente do Sol Delivery.

## Tecnologias

React 19, TypeScript 5, Vite 7, Tauri 2, Rust, SQLite (`rusqlite`), NSIS para instalador Windows. As versões declaradas estão em `package.json` e `src-tauri/Cargo.toml`.

## Utilização

1. Inicie o Sol Fiscal. Em **Atualizações**, baixe a tabela de descrições NCM do Classif (ou importe manualmente a tabela oficial).
2. Em **Análise em lote**, importe o arquivo de produtos. Confirme a empresa.
3. Verifique sugestões e resolva **NCM, CEST, CST e cClassTrib** na aba Revisão. Não confirme código fiscal apenas com base no nome.
4. Conclua o lote, use **Finalizar empresa**, gere Excel/CSV/PDF. Reabra pelo Histórico se precisar corrigir.
5. Em **Atualizações**, verifique a versão do aplicativo manualmente ou permita a busca automática 1 vez/dia. Sem conexão, o app mantém o funcionamento local.

## Executar o código-fonte

Pré-requisitos para desenvolvimento: Node.js LTS, npm, Rust MSVC (Windows), Visual Studio C++ Build Tools e WebView2 Runtime. Execute no terminal **dentro de `Sol-Fiscal`**:

```powershell
npm install
npm run dev              # interface no navegador; funções Tauri requerem desktop
npm run test:core        # testes de motor/importação/exportação
npm run desktop:dev      # aplicativo desktop
npm run desktop:build    # instalador NSIS no Windows
```

O comando `npm run dev` sozinho não executa os comandos nativos do SQLite/atualizador.

## Compilação e instalação Windows

Use o ZIP **Sol-Fiscal-Setup.zip** para obter os scripts de gerador e os recursos de build que ficam fora do ZIP público. Execute `Sol-Fiscal/GERADOR.bat` → **Gerar instalador**. O Setup NSIS usa o novo ícone e instala para o usuário atual. O aplicativo distribuído não exige Node.js, Rust nem um servidor próprio.

## Atualizações via GitHub

Repositório: https://github.com/matheusenalt/sol

- Manifesto exclusivo: [`../updates/fiscal.json`](../updates/fiscal.json) na raiz do monorepo.
- Tags de Release: `fiscal-v1.0.0`, `fiscal-v1.1.0`...
- Asset: `Sol-Fiscal-Setup-X.Y.Z.exe` com hash SHA-256 correspondente.
- Verificação na abertura: sem bloquear; limite de uma tentativa a cada 24 horas. Botão **Verificar atualizações** permite checagem sob demanda.
- Download e instalação: confirmados pelo usuário; backend confere Release, tag, produto, tamanho e hash; app fecha antes do instalador e tenta reabrir após instalação.
- Dados SQLite: mantidos no diretório local do Tauri (identificador estável `br.com.solfiscal.desktop`).
- Offline: continua trabalhando com bases locais. O primeiro manifesto está desativado até a publicação da primeira Release.

Documentação: [Guia de Releases](docs/GITHUB-RELEASES.md) e [Importação Cervantes](docs/IMPORTACAO-CERVANTES.md).

## Segurança e uso open source

Não versionar `.env`, bancos reais, relatórios de clientes, tokens, credenciais, instaladores ou logs. Os testes incluem dados **sintéticos**, nunca um relatório de cliente. Para implantação real, valide a classificação fiscal com fontes oficiais e suporte contábil. SHA-256 protege integridade do download, mas recomendam-se assinatura de código, autenticação forte da conta GitHub e testes Windows antes de release.

## Licença

**Não foi escolhida uma licença open source.** Antes de publicar oficialmente, defina e acrescente um arquivo `LICENSE` (ex.: MIT, Apache-2.0) após confirmar direitos sobre código, bases fiscais e assets. Um repositório público sem licença não concede, por si só, direitos gerais de reutilização.
