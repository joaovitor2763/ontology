/** Brazilian local numbers include DDD. Never guess missing digits or match by suffix. */
export function phoneKey(value: string) {
  const raw = value.trim().replace(/@(?:s\.whatsapp\.net|c\.us)$/, "");
  if (!/^[+\d\s().-]+$/.test(raw)) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits.length >= 12 && digits.length <= 15 ? digits : "";
}

type PhoneContact = { id: string; name?: string; phone?: string };
/** Names are display metadata only; this check never grants account access. */
export function phoneError(next: PhoneContact, all: PhoneContact[]) {
  if (!next.phone?.trim()) return null;
  const key = phoneKey(next.phone);
  if (!key)
    return "Informe um telefone com DDD e, para outros países, o código do país.";
  const duplicate = all.find(
    (p) => p.id !== next.id && phoneKey(p.phone ?? "") === key,
  );
  return duplicate
    ? `Este número já está vinculado a ${duplicate.name || "outra pessoa"}.`
    : null;
}
