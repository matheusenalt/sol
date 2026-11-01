import { normalizeDigits } from './normalize.js';

export type FieldError = {
  field: string;
  message: string;
  value: string;
  expected: string;
};

type ValidatedFields = {
  ncm?: string;
  cst?: string;
  cClassTrib?: string;
};

export function validateFields(input: ValidatedFields): FieldError[] {
  const errors: FieldError[] = [];

  validateLength(errors, 'NCM', input.ncm, 8);
  validateLength(errors, 'CST', input.cst, 3, 'CST IBS/CBS');
  validateLength(errors, 'cClassTrib', input.cClassTrib, 6);

  return errors;
}

function validateLength(
  errors: FieldError[],
  field: string,
  value: string | undefined,
  expectedLength: number,
  label = field,
) {
  if (!value) return;

  const normalized = normalizeDigits(value);
  if (normalized.length === expectedLength) return;

  errors.push({
    field,
    message: `${label} precisa ter ${expectedLength} dígitos.`,
    value: String(value),
    expected: `${expectedLength} dígitos`,
  });
}
