export type ConnectorCapabilities = {
    read: boolean;
    write: boolean;
    backup: boolean;
    rollback: boolean;
};
export type ProductRecord = {
    id: string;
    description: string;
    ncm?: string;
    cest?: string;
    cst?: string;
    cClassTrib?: string;
};
export interface Connector {
    id: string;
    label: string;
    capabilities: ConnectorCapabilities;
    detect(): Promise<boolean>;
    connect(): Promise<void>;
    readProducts(): Promise<ProductRecord[]>;
    validate(): Promise<{
        ok: boolean;
        message: string;
    }>;
    createBackup(): Promise<string>;
    applyChanges(changes: unknown[]): Promise<void>;
    verifyChanges(): Promise<{
        ok: boolean;
        message: string;
    }>;
    rollback(backupId: string): Promise<void>;
}
export const WRITING_DISABLED_REASON = 'A primeira versão do Sol Fiscal Desktop não habilita escrita em ERP. O fluxo futuro exige backup → validação → alteração → verificação → auditoria.';

