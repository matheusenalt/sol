<div align="center">
  <img src="docs/logo.png" alt="Sol — marca oficial" width="142" />

  **Ferramentas de produtividade para suporte técnico.**

  Aplicativos Windows para simplificar tarefas operacionais, organizar informações e reduzir trabalho repetitivo.

  [![GitHub](https://img.shields.io/badge/GitHub-matheusenalt%2Fsol-181717?logo=github&style=flat-square)](https://github.com/matheusenalt/sol)
  ![Plataforma](https://img.shields.io/badge/plataforma-Windows-0078D4?logo=windows&style=flat-square)
  ![Projetos](https://img.shields.io/badge/aplicativos-2-111111?style=flat-square)
  ![Versões](https://img.shields.io/badge/vers%C3%B5es-independentes-FCC419?style=flat-square)

  [Projetos](#aplicativos) · [Instalação](#instalação) · [Atualizações](#atualizações) · [Documentação](#documentação)
</div>

---

## Sobre o projeto

**Sol** reúne ferramentas independentes voltadas a atividades de suporte técnico. O repositório contém os códigos-fonte dos aplicativos e a documentação de uso, segurança e manutenção.

Cada projeto tem sua própria versão, seus recursos e seu processo de atualização. Os instaladores para usuários finais são distribuídos separadamente pelo **GitHub Releases**.

## Aplicativos

| Aplicativo | Finalidade | Documentação | Releases |
|---|---|---|---|
| **Sol Fiscal** | Consulta e revisão assistida de NCM, CEST, CST IBS/CBS e cClassTrib, importação em lote, histórico e exportação. | [Conhecer o Sol Fiscal](Sol-Fiscal/README.md) | [Ver lançamentos](https://github.com/matheusenalt/sol/releases?q=fiscal-) |
| **Sol Delivery** | Organização e conferência de cardápios, importação de planilhas/PDF, cadastro rápido, imagens e relatórios. | [Conhecer o Sol Delivery](Sol-Delivery/README.md) | [Ver lançamentos](https://github.com/matheusenalt/sol/releases?q=delivery-) |

Ambos são ferramentas de **apoio operacional**. O Sol Fiscal não substitui a conferência fiscal especializada; o Sol Delivery não substitui a conferência humana de dados ou imagens.

## Projeto em desenvolvimento

### Sol Gestor MEI

**Status: em desenvolvimento — distribuição e licenciamento ainda em definição.**

O **Sol Gestor MEI** é um aplicativo de gestão desenvolvido para auxiliar no acompanhamento de clientes, obrigações, rotinas administrativas, documentos e atividades fiscais de microempreendedores individuais. O projeto está sendo construído a partir de necessidades reais de uso, com foco na organização das informações e na praticidade do atendimento.

Por enquanto, o Gestor MEI é apresentado aqui apenas como uma iniciativa relacionada ao ecossistema Sol. **Seu código-fonte e instalador não fazem parte deste repositório**, e ainda não há decisão sobre disponibilizá-lo publicamente. Caso seja publicado no futuro, terá documentação e condições de distribuição próprias.

## Tecnologias

| Sol Fiscal | Sol Delivery | Distribuição |
|---|---|---|
| React, TypeScript, Vite | Python, PySide6 (Qt) | GitHub Releases |
| Tauri e Rust | SQLite, Pillow e bibliotecas de importação | Windows 10/11 |
| SQLite local | PyInstaller e Inno Setup no build | SHA-256 e confirmação do usuário |

## Instalação

1. Acesse [Releases](https://github.com/matheusenalt/sol/releases).
2. Escolha a versão do aplicativo desejado pelas tags **`fiscal-vX.Y.Z`** ou **`delivery-vX.Y.Z`**.
3. Baixe o instalador `.exe` anexado à Release correspondente.
4. Confira as notas da versão, execute a instalação e siga as instruções do Windows.

> **Estado inicial:** os manifestos são mantidos inativos até os respectivos instaladores serem publicados e homologados. O repositório pode existir sem que já haja uma Release disponível.

## Executar o código-fonte

### Sol Fiscal

Requer Node.js e, para as funções desktop, Rust MSVC e dependências de build do Tauri no Windows.

```powershell
cd Sol-Fiscal
npm install
npm run test:core
npm run desktop:dev
```

### Sol Delivery

Requer Python 3.12. No Windows:

```powershell
cd Sol-Delivery
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe main.py
```

Para instruções detalhadas, consulte os READMEs individuais. **Os geradores de Setup não fazem parte do pacote de código público.**

## Atualizações

As duas ferramentas consultam recursos públicos do GitHub, sem servidor de API próprio:

| Aplicativo | Manifesto | Tag | Nome do instalador na Release |
|---|---|---|---|
| Sol Fiscal | [`updates/fiscal.json`](updates/fiscal.json) | `fiscal-vX.Y.Z` | `Sol-Fiscal-Setup-X.Y.Z.exe` |
| Sol Delivery | [`updates/delivery.json`](updates/delivery.json) | `delivery-vX.Y.Z` | `Sol Delivery Setup.exe` |

Os atualizadores conferem informações da Release e o hash SHA-256 antes de executar uma atualização. A instalação depende de confirmação do usuário. Sem internet, os aplicativos continuam utilizáveis nas funcionalidades locais.

**Não ative um manifesto antes de publicar, conferir e testar o instalador correspondente.** Veja o [procedimento de publicação](docs/RELEASES.md).

## Estrutura do repositório

```text
sol/
├── README.md
├── .gitignore
├── SECURITY.md
├── docs/
│   ├── RELEASES.md
│   └── VALIDACAO.md
├── updates/
│   ├── fiscal.json
│   └── delivery.json
├── Sol-Fiscal/
│   ├── README.md
│   ├── src/
│   ├── src-tauri/
│   ├── tests/
│   └── docs/
└── Sol-Delivery/
    ├── README.md
    ├── LICENSE
    ├── soldelivery/
    ├── tests/
    ├── assets/
    └── docs/
```

## Documentação

- [Sol Fiscal — documentação do aplicativo](Sol-Fiscal/README.md)
- [Sol Delivery — documentação do aplicativo](Sol-Delivery/README.md)
- [Como publicar os instaladores no GitHub Releases](docs/RELEASES.md)
- [Validações e limitações da entrega](docs/VALIDACAO.md)
- [Segurança e divulgação responsável](SECURITY.md)

## Segurança e licença

Este repositório não deve receber senhas, tokens, bancos de clientes, dados reais de empresas, logs privados ou instaladores binários. Consulte o [guia de segurança](SECURITY.md) antes de publicar alterações.

O **Sol Delivery** possui licença MIT no seu [arquivo próprio](Sol-Delivery/LICENSE). O **Sol Fiscal ainda não possui licença de código aberto definida**; a visibilidade pública do código não concede automaticamente permissões de redistribuição e modificação. Não há licença MIT global para todo o repositório.

---

<div align="center">
  <p><strong>Desenvolvido e mantido por Matheus</strong></p>
  <a href="https://github.com/matheusenalt">GitHub: @matheusenalt</a>

  <p><strong>Sol — ferramentas úteis, simples e independentes.</strong></p>
</div>
