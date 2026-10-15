import { setClientResponsible } from "../domain/set-responsible";
import { workspaceDate } from "@/shared/lib/format";
import {
  allocationsFor,
  removeAllocation,
  upsertAllocation,
  type Allocation,
} from "@/modules/clients/domain/allocation";
import type { Company } from "@/modules/clients/domain/models";
import { enrollmentCanReceiveWork, enrollmentRemovalError, upsertEnrollment, type ProductEnrollment } from "../domain/product-enrollments";
import { upsertParticipation, type ProductStakeholderParticipation } from "../domain/product-stakeholders";
import type { Stakeholder } from "../domain/stakeholders";
import {
  type ServiceConfig,
} from "@/modules/clients/domain/service-config";
import { companies as seedClients } from "@/modules/clients/infrastructure/seed";
import { migrateLegacy } from "@/shared/infrastructure/migration";
import { useLocalStorageState } from "@/shared/infrastructure/useLocalStorageState";
import { notify } from "@/shared/ui/Feedback";
import { useMemo } from "react";

import { CLIENTS_INITIAL as INITIAL, normalizeClientsSnapshot, projectClients, type ClientsSnapshot as StoredState } from "./snapshot";
export type { ClientsSnapshot as StoredState } from "./snapshot";
const migrate = () =>
  migrateLegacy(INITIAL, [
    "ontology.praxis.v1",
    "ontology.services.v1",
    "ontology.clients.v2",
  ]);

const stamp = () => new Date().toISOString();

type API = {
  enrollments: StoredState["enrollments"];
  participations: StoredState["participations"];
  saveEnrollment: (enrollment: ProductEnrollment) => void;
  removeEnrollment: (enrollmentId: string, options?: { preserveProductLink?: boolean }) => void;
  provisionEnrollmentPlan: (expected: Pick<ProductEnrollment, "id" | "company" | "productId" | "productVersion" | "startsAt">, planId: string, materialize: () => void) => void;
  saveParticipation: (participation: ProductStakeholderParticipation, contacts: Stakeholder[]) => void;
  storageError: string | null;
  /** Active clients, seed merged with edits and created records. */
  clients: Company[];
  /** Every client, archived included. */
  allClients: Company[];
  clientBySlug: (slug: string) => Company | undefined;
  saveClient: (client: Company) => void;
  createClient: (client: Company, config?: ServiceConfig) => void;
  archiveClient: (slug: string) => void;
  restoreClient: (slug: string) => void;
  configFor: (slug: string) => ServiceConfig;
  saveConfig: (slug: string, config: ServiceConfig) => void;
  allocations: Allocation[];
  allocationsFor: (slug: string) => Allocation[];
  assigned: (c: Pick<Company, "slug" | "leadId" | "csId">) => {
    leadId: string;
    csId: string;
  };
  saveAllocation: (allocation: Allocation) => void;
  deleteAllocation: (id: string) => void;
  /** Convenience for the two singular roles. */
  setResponsible: (company: string, memberId: string | null, enrollmentId?: string) => void;
  setAssignment: (slug: string, leadId: string, csId: string) => void;
};

export function useClientsState(): API {
  const [rawStored, setStored, storageError] = useLocalStorageState(
    "ontology.clients.v3",
    INITIAL,
    migrate,
  );
  // Projeção por documento, não por renderização: todo consumidor lê o mesmo objeto.
  const stored = useMemo(() => normalizeClientsSnapshot(rawStored), [rawStored]);
  const projected = useMemo(() => projectClients(stored), [stored]);
  const { allClients, clients, allocations } = projected;
  const ensureMigrated = (rows: Allocation[]) =>
    setStored((s) => ({
      ...s,
      allocations: rows,
      allocationsMigrated: true,
    }));

  const value: API = {
    enrollments: stored.enrollments,
    participations: stored.participations,
    saveEnrollment(enrollment) {
      setStored(raw => {
        const s = normalizeClientsSnapshot(raw);
        return { ...s, enrollments: upsertEnrollment(s.enrollments, enrollment) };
      });
    },
    removeEnrollment(enrollmentId, options) {
      setStored(raw => {
        const s = normalizeClientsSnapshot(raw);
        const removed = s.enrollments.find(row => row.id === enrollmentId);
        if (!removed) return s;
        const removalIssue = enrollmentRemovalError(removed);
        if (removalIssue) throw new Error(removalIssue);
        if (s.enrollments.some(row => row.previousEnrollmentId === enrollmentId))
          throw new Error("Esta contratação é a origem de uma renovação. Cancele-a para preservar o histórico da relação.");
        if (projectClients(s).allocations.some(row => row.enrollmentId === enrollmentId))
          throw new Error("Remova primeiro as pessoas alocadas especificamente a esta contratação.");
        const enrollments = s.enrollments.filter(row => row.id !== enrollmentId);
        const productStillLinked = enrollments.some(row => row.company === removed.company && row.productId === removed.productId);
        const config = projectClients(s).configFor(removed.company);
        return {
          ...s,
          enrollments,
          participations: s.participations.filter(row => row.enrollmentId !== enrollmentId),
          ...(!productStillLinked && !options?.preserveProductLink ? { configs: { ...s.configs, [removed.company]: { ...config, productIds: (config.productIds ?? []).filter(id => id !== removed.productId) } } } : {}),
        };
      });
    },
    provisionEnrollmentPlan(expected, planId, materialize) {
      // This storage updater is synchronous: validate the latest purchase before
      // materializing execution, then merge only the plan link into that purchase.
      setStored(raw => {
        const s = normalizeClientsSnapshot(raw);
        const current = s.enrollments.find(e => e.id === expected.id);
        if (!current || current.company !== expected.company || current.productId !== expected.productId || current.productVersion !== expected.productVersion || current.startsAt !== expected.startsAt || !enrollmentCanReceiveWork(current))
          throw new Error("A contratação mudou. Reabra a preparação antes de continuar.");
        if (current.planId && current.planId !== planId)
          throw new Error("A contratação já segue outro plano. Reabra a preparação.");
        materialize();
        return { ...s, enrollments: s.enrollments.map(e => e.id === current.id ? { ...e, planId } : e) };
      });
    },
    saveParticipation(participation, contacts) {
      setStored(raw => {
        const s = normalizeClientsSnapshot(raw);
        return { ...s, participations: upsertParticipation(s.participations, participation, s.enrollments, contacts) };
      });
    },
    storageError,
    clients,
    allClients,
    clientBySlug: (slug) => allClients.find((c) => c.slug === slug),
    saveClient(client) {
      const isSeed = seedClients.some((c) => c.slug === client.slug);
      setStored((s) =>
        isSeed
          ? {
              ...s,
              clientEdits: {
                ...s.clientEdits,
                [client.slug]: { ...client, updatedAt: stamp() },
              },
            }
          : {
              ...s,
              extraClients: s.extraClients.map((c) =>
                c.slug === client.slug ? { ...client, updatedAt: stamp() } : c,
              ),
            },
      );
      notify("Cliente atualizado");
    },
    createClient(client, config) {
      const now = stamp();
      setStored((s) => ({
        ...s,
        extraClients: [
          ...s.extraClients.filter((c) => c.slug !== client.slug),
          { ...client, createdAt: now, updatedAt: now },
        ],
        configs: config ? { ...s.configs, [client.slug]: config } : s.configs,
        allocations: s.allocationsMigrated ? s.allocations : allocations,
        allocationsMigrated: true,
      }));
      notify(`Cliente ${client.name} criado`);
    },
    archiveClient(slug) {
      setStored((s) => ({
        ...s,
        archivedClients: s.archivedClients.includes(slug)
          ? s.archivedClients
          : [...s.archivedClients, slug],
      }));
      notify("Cliente arquivado", () =>
        setStored((s) => ({
          ...s,
          archivedClients: s.archivedClients.filter((x) => x !== slug),
        })),
      );
    },
    restoreClient(slug) {
      setStored((s) => ({
        ...s,
        archivedClients: s.archivedClients.filter((x) => x !== slug),
      }));
      notify("Cliente reativado");
    },
    configFor: projected.configFor,
    saveConfig(slug, config) {
      setStored((s) => ({ ...s, configs: { ...s.configs, [slug]: config } }));
      notify("Escopo e recursos do cliente atualizados");
    },
    allocations,
    allocationsFor: (slug) => allocationsFor(allocations, slug),
    assigned: projected.assigned,
    saveAllocation(allocation) {
      const next = upsertAllocation(allocations, {
        ...allocation,
        updatedAt: stamp(),
        createdAt: allocation.createdAt ?? stamp(),
      });
      ensureMigrated(next);
      notify("Alocação atualizada");
    },
    deleteAllocation(id) {
      const previous = allocations;
      ensureMigrated(removeAllocation(allocations, id));
      notify("Alocação removida", () => ensureMigrated(previous));
    },
    setResponsible(company, memberId, enrollmentId) {
      setStored(raw => {
        const state = normalizeClientsSnapshot(raw), current = projectClients(state), at = stamp();
        return { ...state, allocationsMigrated: true,
          allocations: setClientResponsible(current.allocations, current.enrollments, { company, memberId, enrollmentId }, at, workspaceDate(at)),
          clientEdits: enrollmentId ? state.clientEdits : { ...state.clientEdits, [company]: { ...state.clientEdits[company], leadId: memberId ?? "" } },
        };
      });
    },
    setAssignment(slug, leadId, csId) {
      let next = allocations;
      const at = stamp();
      next = upsertAllocation(next, {
        id: `alloc-${slug}-responsavel`,
        company: slug,
        memberId: leadId,
        role: "responsavel",
        percent:
          allocationsFor(next, slug).find((a) => a.role === "responsavel")
            ?.percent ?? 30,
        updatedAt: at,
      });
      next = upsertAllocation(next, {
        id: `alloc-${slug}-cs`,
        company: slug,
        memberId: csId,
        role: "cs",
        percent:
          allocationsFor(next, slug).find((a) => a.role === "cs")?.percent ??
          10,
        updatedAt: at,
      });
      ensureMigrated(next);
      notify("Responsáveis do cliente atualizados");
    },
  };
  return value;
}
