import { phoneKey } from "./phone.ts";

export const MAX_CONTACT_POINTS = 10;

export type ContactPointOwner = {
  id: string;
  name?: string;
  org?: string;
  company?: string;
  email?: string;
  emails?: string[];
  phone?: string;
  phones?: string[];
};

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function contactEmails(owner: ContactPointOwner): string[] {
  const values = Array.isArray(owner.emails)
    ? owner.emails
    : owner.email
      ? [owner.email]
      : [];
  return unique(values.map((value) => value.trim().toLowerCase()));
}

export function contactPhones(owner: ContactPointOwner): string[] {
  const values = Array.isArray(owner.phones)
    ? owner.phones
    : owner.phone
      ? [owner.phone]
      : [];
  return unique(values.map(phoneKey));
}

/** Adds canonical arrays while retaining the legacy primary aliases. */
export function normalizeContactPoints<T extends ContactPointOwner>(owner: T) {
  const emails = contactEmails(owner);
  const phones = contactPhones(owner);
  return {
    ...owner,
    emails,
    phones,
    email: emails[0] ?? "",
    phone: phones[0] ?? "",
  };
}

/** Legacy singular edits must override arrays inherited from the base record. */
export function mergeContactPoints<
  T extends ContactPointOwner,
  U extends Partial<ContactPointOwner>,
>(base: T, overlay?: U) {
  const merged = { ...base, ...overlay } as T & U;
  if (
    overlay &&
    Object.hasOwn(overlay, "email") &&
    !Object.hasOwn(overlay, "emails")
  )
    delete merged.emails;
  if (
    overlay &&
    Object.hasOwn(overlay, "phone") &&
    !Object.hasOwn(overlay, "phones")
  )
    delete merged.phones;
  return normalizeContactPoints(merged);
}

function identity(owner: ContactPointOwner) {
  return `${owner.org ?? "person"}:${owner.company ?? "workspace"}:${owner.id}`;
}

/** Validates every address and enforces one global owner per contact point. */
export function contactPointsError(
  next: ContactPointOwner,
  all: ContactPointOwner[],
) {
  const rawEmails = Array.isArray(next.emails)
    ? next.emails
    : next.email
      ? [next.email]
      : [];
  const rawPhones = Array.isArray(next.phones)
    ? next.phones
    : next.phone
      ? [next.phone]
      : [];
  if (rawEmails.filter((value) => value.trim()).length > MAX_CONTACT_POINTS)
    return `Cadastre no máximo ${MAX_CONTACT_POINTS} e-mails por pessoa.`;
  if (rawPhones.filter((value) => value.trim()).length > MAX_CONTACT_POINTS)
    return `Cadastre no máximo ${MAX_CONTACT_POINTS} telefones por pessoa.`;
  if (
    rawEmails.some(
      (value) =>
        value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()),
    )
  )
    return "Informe um e-mail válido.";
  if (rawPhones.some((value) => value.trim() && !phoneKey(value)))
    return "Informe um telefone válido com DDD.";

  const emails = new Set(contactEmails(next));
  const phones = new Set(contactPhones(next));
  const ownerId = identity(next);
  for (const person of all) {
    if (identity(person) === ownerId) continue;
    if (contactEmails(person).some((email) => emails.has(email)))
      return "Este e-mail já pertence a outra pessoa no workspace.";
    if (contactPhones(person).some((phone) => phones.has(phone)))
      return "Este telefone já pertence a outra pessoa no workspace.";
  }
  return null;
}
