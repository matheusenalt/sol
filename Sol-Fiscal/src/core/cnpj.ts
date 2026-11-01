export type CnpjValidation = {
  clean: string;
  valid: boolean;
  alphanumeric: boolean;
  reason?: string;
};

export function normalizeCnpj(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function charValue(char: string): number {
  return char.charCodeAt(0) - 48;
}

function calculateDigit(chars: string[], weights: number[]): number {
  const total = chars.reduce((sum, char, index) => sum + charValue(char) * weights[index], 0);
  const remainder = total % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function calculateCnpjDv(base12: string): string | null {
  const clean = normalizeCnpj(base12);
  if (!/^[0-9A-Z]{12}$/.test(clean)) return null;
  const first = calculateDigit(clean.split(''), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculateDigit([...clean.split(''), String(first)], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${first}${second}`;
}

export function validateCnpj(value: string): CnpjValidation {
  const clean = normalizeCnpj(value);
  const alphanumeric = /[A-Z]/.test(clean.slice(0, 12));
  if (clean.length !== 14) return { clean, valid: false, alphanumeric, reason: 'O CNPJ precisa ter 14 posições.' };
  if (!/^[0-9A-Z]{12}\d{2}$/.test(clean)) {
    return { clean, valid: false, alphanumeric, reason: 'As 12 primeiras posições aceitam letras e números; os 2 dígitos finais precisam ser numéricos.' };
  }
  if (/^([0-9])\1{13}$/.test(clean)) return { clean, valid: false, alphanumeric, reason: 'CNPJ inválido.' };
  const expected = calculateCnpjDv(clean.slice(0, 12));
  if (!expected || expected !== clean.slice(12)) {
    return { clean, valid: false, alphanumeric, reason: 'Dígitos verificadores inválidos.' };
  }
  return { clean, valid: true, alphanumeric };
}

export function formatCnpj(value: string): string {
  const clean = normalizeCnpj(value);
  if (clean.length !== 14) return value;
  return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-${clean.slice(12)}`;
}
