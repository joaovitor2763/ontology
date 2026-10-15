import {
  contactEmails,
  contactPhones,
  MAX_CONTACT_POINTS,
  type ContactPointOwner,
} from "../../shared/lib/contact-points.ts";
import { phoneKey } from "../../shared/lib/phone.ts";
import * as v from "./input.ts";

function list(value: unknown, label: string, maxLength: number) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_CONTACT_POINTS ||
    value.some((item) => typeof item !== "string" || item.length > maxLength)
  )
    v.invalid(`Informe até ${MAX_CONTACT_POINTS} ${label} válidos.`);
  return value.map((item) => item.trim()).filter(Boolean);
}

function replacePrimary(current: string[], next: string) {
  if (!next) return current.slice(1);
  return [next, ...current.slice(1).filter((value) => value !== next)];
}

/** Accepts the new arrays and the legacy primary fields without losing secondary values. */
export function contactInput(
  raw: Record<string, unknown>,
  previous?: ContactPointOwner,
) {
  const previousEmails = previous ? contactEmails(previous) : [];
  const previousPhones = previous ? contactPhones(previous) : [];
  let emails = Object.hasOwn(raw, "emails")
    ? list(raw.emails, "e-mails", 320).map((email) => email.toLowerCase())
    : previousEmails;
  let phones = Object.hasOwn(raw, "phones")
    ? list(raw.phones, "telefones", 100)
    : previousPhones;

  if (Object.hasOwn(raw, "email")) {
    const email = v.string(raw.email, "e-mail", undefined, 320).toLowerCase();
    if (Object.hasOwn(raw, "emails") && email !== (emails[0] ?? ""))
      v.invalid("O e-mail principal deve ser o primeiro item de e-mails.");
    if (!Object.hasOwn(raw, "emails")) emails = replacePrimary(emails, email);
  }
  if (Object.hasOwn(raw, "phone")) {
    const phone = v.string(raw.phone, "telefone", undefined, 100);
    if (
      Object.hasOwn(raw, "phones") &&
      phoneKey(phone) !== phoneKey(phones[0] ?? "")
    )
      v.invalid("O telefone principal deve ser o primeiro item de telefones.");
    if (!Object.hasOwn(raw, "phones")) phones = replacePrimary(phones, phone);
  }
  return {
    emails,
    phones,
    email: emails[0] ?? "",
    phone: phones[0] ?? "",
  };
}
