/**
 * Messages of a client's WhatsApp group, read from an external base (today a
 * Supabase table filled by the WhatsApp integration). Read-only: the app never
 * writes to the group. Column names vary per base, so the mapping is explicit.
 */
export type WhatsAppMessage = {
  id: string;
  /** ISO instant. */
  at: string;
  from: string;
  text: string;
  fromMe: boolean;
  group: string;
};

export type WhatsAppColumns = {
  group: string;
  /** Group name as shown in WhatsApp; the platform filters by it when no id is set. */
  groupName?: string;
  id: string;
  at: string;
  from: string;
  text: string;
  /** Optional boolean column: message sent by our number. */
  fromMe?: string;
};

export const defaultWhatsAppColumns: WhatsAppColumns = {
  group: "group_id",
  groupName: "group_name",
  id: "id",
  at: "created_at",
  from: "sender_name",
  text: "body",
  fromMe: "from_me",
};

/** One row of the base → one message; rows without id or a valid date are skipped. */
export function mapWhatsAppRow(
  row: Record<string, unknown>,
  columns: WhatsAppColumns = defaultWhatsAppColumns,
): WhatsAppMessage | null {
  const id = row[columns.id];
  const rawAt = row[columns.at];
  if (id == null || id === "" || rawAt == null || rawAt === "") return null;
  const date = new Date(String(rawAt));
  if (Number.isNaN(date.getTime())) return null;
  const from = String(row[columns.from] ?? "").trim();
  return {
    id: String(id),
    at: date.toISOString(),
    from: from || "Desconhecido",
    text: String(row[columns.text] ?? ""),
    fromMe: Boolean(columns.fromMe && row[columns.fromMe]),
    group: String(row[columns.group] ?? ""),
  };
}

export function sortWhatsAppMessages(list: WhatsAppMessage[]) {
  return [...list].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
