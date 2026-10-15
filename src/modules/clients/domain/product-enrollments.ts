export type EnrollmentLifecycleEntry = {
  type: "created" | "status" | "archived" | "restored" | "execution_rebuilt";
  at: string;
  by: string;
  from?: ProductEnrollment["status"];
  to?: ProductEnrollment["status"];
  reason?: string;
};

/** A purchase/renewal has its own identity, independently of the catalogue product. */
export type ProductEnrollment = {
  id: string;
  company: string;
  productId: string;
  productVersion?: number;
  soldAt?: string;
  startsAt?: string;
  endsAt?: string;
  status: "planejada" | "ativa" | "pausada" | "concluida" | "cancelada";
  planId?: string;
  /** Missing in historical purchases; resolved without rewriting the client's legacy marker. */
  milestone?: number;
  milestoneHistory?: { from: number; to: number; at: string; by: string; justification?: string; pendingTaskIds: string[] }[];
  previousEnrollmentId?: string;
  /** This purchase introduced the client-product link; ownership moves to a surviving purchase on removal. */
  createdProductLink?: boolean;
  /** Inferred legacy association; missing historical facts deliberately stay unknown. */
  legacy?: boolean;
  /** Hidden from current-work selectors without erasing the commercial relationship. */
  archivedAt?: string;
  archivedBy?: string;
  lifecycleHistory?: EnrollmentLifecycleEntry[];
  createdAt?: string;
  createdBy?: string;
};

export const enrollmentStatusLabel: Record<ProductEnrollment["status"], string> = {
  planejada: "Planejada", ativa: "Ativa", pausada: "Pausada",
  concluida: "Concluída", cancelada: "Cancelada",
};

export const enrollmentIsCurrent = (enrollment: ProductEnrollment) =>
  !enrollment.archivedAt && enrollment.status !== "cancelada";

export const enrollmentCanReceiveWork = (enrollment: ProductEnrollment) =>
  !enrollment.archivedAt && ["planejada", "ativa"].includes(enrollment.status ?? "ativa");

export function enrollmentRemovalError(enrollment: ProductEnrollment): string | null {
  if (enrollment.legacy || enrollment.archivedAt || !["planejada", "ativa"].includes(enrollment.status ?? "ativa"))
    return "Somente uma contratação ativa ou planejada, criada por engano, pode ser excluída. Cancele contratos reais para preservar o histórico.";
  if (enrollment.lifecycleHistory?.length !== 1 || enrollment.lifecycleHistory[0].type !== "created")
    return "Esta contratação já possui histórico. Cancele-a para preservar a relação com o cliente.";
  return null;
}

/** Calendar date of an instant in the workspace business timezone. */
export function enrollmentBusinessDate(at: string): string {
  // g4os-ds-disable-next-line number-format -- data ISO (aaaa-mm-dd) para comparação no fuso do negócio, não é exibida
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function changeEnrollmentStatus(
  enrollment: ProductEnrollment,
  status: ProductEnrollment["status"],
  by: string,
  at: string,
  reason?: string,
): ProductEnrollment {
  if (status === enrollment.status) return enrollment;
  if (enrollment.archivedAt)
    throw new Error("Restaure a contratação antes de alterar sua situação.");
  if (enrollment.status === "cancelada")
    throw new Error("Uma contratação cancelada não pode ser reativada.");
  const note = reason?.trim();
  if (status === "cancelada" && !note)
    throw new Error("Informe o motivo do cancelamento.");
  return {
    ...enrollment,
    status,
    ...(status === "cancelada" && !enrollment.endsAt && (
      !enrollment.startsAt || enrollmentBusinessDate(at) >= enrollment.startsAt
    )
      ? { endsAt: enrollmentBusinessDate(at) }
      : {}),
    lifecycleHistory: [
      ...(enrollment.lifecycleHistory ?? []),
      {
        type: "status",
        at,
        by,
        from: enrollment.status,
        to: status,
        ...(note ? { reason: note } : {}),
      },
    ],
  };
}

export function archiveEnrollment(
  enrollment: ProductEnrollment,
  by: string,
  at: string,
): ProductEnrollment {
  if (enrollment.archivedAt) return enrollment;
  if (!["concluida", "cancelada"].includes(enrollment.status))
    throw new Error("Conclua ou cancele a contratação antes de arquivá-la.");
  return {
    ...enrollment,
    archivedAt: at,
    archivedBy: by,
    lifecycleHistory: [
      ...(enrollment.lifecycleHistory ?? []),
      { type: "archived", at, by },
    ],
  };
}

export function restoreEnrollment(
  enrollment: ProductEnrollment,
  by: string,
  at: string,
): ProductEnrollment {
  if (!enrollment.archivedAt) return enrollment;
  const next = { ...enrollment };
  delete next.archivedAt;
  delete next.archivedBy;
  next.lifecycleHistory = [
    ...(enrollment.lifecycleHistory ?? []),
    { type: "restored", at, by },
  ];
  return next;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Callers must separately authorize the operation and resolve catalogue/client existence. */
export function enrollmentError(next: ProductEnrollment, all: ProductEnrollment[] = []): string | null {
  if (!next.id.trim() || !next.company.trim() || !next.productId.trim())
    return "Informe a identidade da contratação, o cliente e o produto.";
  if (!Object.hasOwn(enrollmentStatusLabel, next.status)) return "Informe uma situação válida para a contratação.";
  if (!next.legacy && (!next.startsAt || next.productVersion === undefined))
    return "Informe o início e a versão do produto da contratação.";
  if (next.productVersion !== undefined && (!Number.isInteger(next.productVersion) || next.productVersion < 1))
    return "Informe uma versão válida do produto.";
  if ([next.startsAt, next.endsAt, next.soldAt].some(date => date !== undefined && !validDate(date)))
    return "Informe datas válidas para a contratação.";
  if (next.endsAt && next.startsAt && next.endsAt < next.startsAt)
    return "O término da contratação não pode anteceder o início.";
  const previous = all.find(row => row.id === next.id);
  // Only incoming dates are bounded; a stored legacy value never blocks other edits.
  if ((["startsAt", "endsAt", "soldAt"] as const).some(field => next[field] !== undefined && next[field] !== previous?.[field] && (next[field]! < "2000-01-01" || next[field]! > "2100-12-31")))
    return "Informe datas da contratação entre 2000 e 2100.";
  if (previous && (previous.company !== next.company || previous.productId !== next.productId))
    return "O cliente e o produto de uma contratação existente não podem ser alterados.";
  if (next.startsAt && all.some(row =>
    row.id !== next.id &&
    row.company === next.company &&
    row.productId === next.productId &&
    row.startsAt === next.startsAt
  )) return "Já existe uma contratação deste produto com o mesmo início. Abra a contratação existente ou informe outra data.";
  if (next.previousEnrollmentId) {
    const origin = all.find(row => row.id === next.previousEnrollmentId);
    if (!origin || origin.company !== next.company || origin.productId !== next.productId)
      return "A contratação anterior precisa pertencer ao mesmo cliente e produto.";
    const visited = new Set([next.id]);
    let cursor: ProductEnrollment | undefined = origin;
    while (cursor) {
      if (visited.has(cursor.id)) return "A renovação não pode formar uma referência circular.";
      visited.add(cursor.id);
      cursor = all.find(row => row.id === cursor?.previousEnrollmentId);
    }
  }
  return null;
}

export function upsertEnrollment(all: ProductEnrollment[], next: ProductEnrollment): ProductEnrollment[] {
  const error = enrollmentError(next, all);
  if (error) throw new Error(error);
  return [...all.filter(row => row.id !== next.id), { ...next }];
}
