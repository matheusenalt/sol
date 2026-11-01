# Conectores ERP

O Sol Core não conhece Firebird, SGBR, Retaguarda nem caminhos locais. Conectores implementam o contrato de `types.ts`.

Nesta fase a escrita permanece **desabilitada por projeto**. A referência do GL mostrou que escrita segura precisa incluir backup verificável, transação, verificação e rollback. Credenciais e caminhos nunca entram no Core.
