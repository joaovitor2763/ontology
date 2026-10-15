import { OperationError } from './errors.ts';
export function invalid(message: string): never { throw new OperationError(422, 'invalid_input', message); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Informe um objeto válido.');
  return value as Record<string, unknown>;
}
export function string(value: unknown, label: string, fallback?: string, max = 10000): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) invalid(`Informe ${label} válido.`);
  return value.trim();
}
export function id(value: unknown, label = 'identificador'): string {
  const result = string(value, label, undefined, 180);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(result)) invalid(`Informe ${label} válido.`);
  return result;
}
export function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 500 || value.some(v => typeof v !== 'string')) invalid(`Informe ${label} válidos.`);
  return [...new Set(value.map(v => id(v, label)))];
}
export function choice<T extends string>(value: unknown, options: readonly T[], fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !options.includes(value as T)) invalid('Informe uma opção válida.');
  return value as T;
}
export function boolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') invalid('Informe um valor booleano.');
  return value;
}
export function number(value: unknown, fallback: number, min = 0, max = 100000): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid('Informe um número válido.');
  return value;
}
