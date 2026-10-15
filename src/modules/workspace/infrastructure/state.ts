import {
  alertRulesError,
  resolveAlertRules,
  type AlertRules,
  type NamedRole,
  type Person,
} from "@/modules/workspace/domain/models";
import {
  migrateLegacy,
  migrateMemberPhones,
  migrateRoleCatalogs,
} from "@/shared/infrastructure/migration";
import { useLocalStorageState, useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { notify } from "@/shared/ui/Feedback";
import { effectiveCurrentUserId, rosterMembers } from "@/modules/workspace/domain/session-identity";
import { useMemo, type SetStateAction } from "react";
import { currentUserId as seedUserId, people } from "./seed";
export type StoredState = {
  /**
   * Arquivo antigo e compartilhado de alertas vistos: esconde para toda a
   * equipe. A ciência nova é por pessoa (no servidor, `alert_acknowledgments`;
   * no modo navegador, `ontology.alert-seen.v1`) e nunca grava aqui.
   */
  hidden: string[];
  extraMembers: Person[];
  deactivatedIds: string[];
  /** Field-level edits over seeded members, keyed by id. */
  memberEdits: Record<string, Partial<Person>>;
  /**
   * Modo navegador: quem usa o workspace neste navegador ("ver como").
   * Publicado, o campo é legado: não é lido nem gravado (ver `currentUserId` da API).
   */
  currentUserId: string;
  workspaceName: string;
  /** Overrides of the default alert thresholds, set in Configurações. */
  alertRules: Partial<AlertRules>;
  memberRoles: string[];
  allocationRoles: NamedRole[];
};
const INITIAL: StoredState = {
  hidden: [],
  extraMembers: [],
  deactivatedIds: [],
  memberEdits: {},
  currentUserId: "",
  workspaceName: "",
  alertRules: {},
  memberRoles: [],
  allocationRoles: [],
};
/** Modo navegador: alertas vistos por membro ("ver como"), fora do documento do workspace. */
const SEEN_KEY = "ontology.alert-seen.v1";
const NO_SEEN: Record<string, string[]> = {};
const migrate = () =>
  migrateLegacy(INITIAL, ["ontology.praxis.v1", "ontology.workspace.v2"]);
const stamp = () => new Date().toISOString();
type API = {
  storageError: string | null;
  /**
   * Escondidos para quem usa: o arquivo da equipe e, no modo navegador, o que
   * o membro atual marcou. Publicado, a fila por pessoa vem do servidor.
   */
  hiddenAlerts: Set<string>;
  extraMembers: Person[];
  memberEdits: Record<string, Partial<Person>>;
  deactivated: Set<string>;
  /**
   * Membro atual, usado como autor e nas permissões da interface. Publicado, é
   * o membro da sessão (e-mail do login), nunca o valor do documento
   * compartilhado; `""` enquanto o roster não traz essa pessoa. No modo
   * navegador, é o "ver como" gravado.
   */
  currentUserId: string;
  workspaceName: string;
  /** Thresholds behind the derived alerts, defaults filled in. */
  alertRules: AlertRules;
  memberRoles: string[];
  allocationRoles: NamedRole[];
  /** Modo navegador: ciência do membro atual. Publicado, a ciência é o comando `alerts.acknowledge`. */
  acknowledge: (id: string) => void;
  acknowledgeMany: (ids: string[]) => void;
  addMember: (p: Person) => void;
  updateMember: (p: Person) => void;
  toggleMember: (id: string) => void;
  /** Só no modo navegador ("ver como"). Publicado não grava nada. */
  setCurrentUser: (id: string, quiet?: boolean) => void;
  setWorkspaceName: (name: string) => void;
  /** Saves the overrides; returns the validation message when refused. */
  setAlertRules: (rules: Partial<AlertRules>) => string | null;
  setMemberRoles: (roles: string[]) => void;
  setAllocationRoles: (roles: NamedRole[]) => void;
};
export function useWorkspaceState(): API {
  const [stored, setStored, storageError] = useLocalStorageState(
    "ontology.workspace.v3",
    INITIAL,
    migrate,
  );
  const { hidden, extraMembers, deactivatedIds, memberEdits, memberRoles, allocationRoles } = useMemo(
    () => migrateRoleCatalogs(migrateMemberPhones(stored)),
    [stored],
  );
  const { mode, user } = useSyncStatus();
  const [seenByMember, setSeenByMember] = useLocalStorageState(SEEN_KEY, NO_SEEN);
  const sessionEmail = mode === "remote" ? user?.email : undefined;
  // Mesma lista e mesma regra de `useTeam().me`: publicado, quem usa é a sessão.
  const currentUserId = useMemo(
    () =>
      effectiveCurrentUserId({
        mode,
        sessionEmail,
        members:
          mode === "remote" ? rosterMembers(extraMembers, memberEdits, people) : [],
        storedId: stored.currentUserId,
        fallbackId: seedUserId,
      }),
    [mode, sessionEmail, extraMembers, memberEdits, stored.currentUserId],
  );
  const seen = mode === "remote" ? undefined : seenByMember[currentUserId];
  const hiddenAlerts = useMemo(() => new Set([...hidden, ...(seen ?? [])]), [hidden, seen]);
  const setSeen = (update: (ids: string[]) => string[]) =>
    setSeenByMember((all) => ({ ...all, [currentUserId]: update(all[currentUserId] ?? []) }));
  function field<K extends keyof StoredState>(key: K) {
    return (action: SetStateAction<StoredState[K]>) =>
      setStored((previous) => ({
        ...previous,
        [key]:
          typeof action === "function"
            ? (action as (value: StoredState[K]) => StoredState[K])(
                previous[key],
              )
            : action,
      }));
  }
  const setExtraMembers = field("extraMembers");
  const setDeactivatedIds = field("deactivatedIds");
  const setMemberEdits = field("memberEdits");
  const value: API = {
    storageError,
    hiddenAlerts,
    extraMembers,
    memberEdits,
    deactivated: new Set(deactivatedIds),
    currentUserId,
    workspaceName: stored.workspaceName || "Meu workspace",
    alertRules: resolveAlertRules(stored.alertRules),
    memberRoles,
    allocationRoles,
    acknowledge: (id) => {
      setSeen((h) => (h.includes(id) ? h : [...h, id]));
      notify("Alerta marcado como visto", () =>
        setSeen((h) => h.filter((item) => item !== id)),
      );
    },
    acknowledgeMany: (ids) => {
      setSeen((seen) => [...new Set([...seen, ...ids])]);
    },
    addMember: (p) => {
      const now = stamp();
      setExtraMembers((xs) => [
        { ...p, createdAt: now, updatedAt: now },
        ...xs,
      ]);
      notify("Membro adicionado à equipe");
    },
    updateMember: (p) => {
      const isSeed = people.some((x) => x.id === p.id);
      if (isSeed)
        setMemberEdits((e) => ({
          ...e,
          [p.id]: { ...p, updatedAt: stamp() },
        }));
      else
        setExtraMembers((xs) =>
          xs.map((x) => (x.id === p.id ? { ...p, updatedAt: stamp() } : x)),
        );
      notify("Membro atualizado");
    },
    toggleMember: (id) => {
      const wasActive = !deactivatedIds.includes(id);
      setDeactivatedIds((ids) =>
        ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
      );
      notify(wasActive ? "Membro desativado" : "Membro reativado", () =>
        setDeactivatedIds((ids) =>
          wasActive ? ids.filter((x) => x !== id) : [...ids, id],
        ),
      );
    },
    setCurrentUser: (id, quiet) => {
      // Publicado, o membro atual vem da sessão; gravar aqui reescreveria o
      // roster compartilhado de todos (cache, versão e contador de alertas).
      if (mode === "remote") return;
      setStored((s) => ({ ...s, currentUserId: id }));
      if (!quiet) notify("Agora você está vendo o workspace como outro membro");
    },
    setWorkspaceName: (name) => {
      setStored((s) => ({ ...s, workspaceName: name.trim() }));
      notify("Workspace atualizado");
    },
    setAlertRules: (rules) => {
      const error = alertRulesError(rules);
      if (error) return error;
      setStored((s) => ({ ...s, alertRules: rules }));
      notify("Regras de alerta atualizadas");
      return null;
    },
    setMemberRoles: (roles) => {
      setStored((s) => ({ ...s, memberRoles: roles }));
      notify("Cargos da equipe atualizados");
    },
    setAllocationRoles: (roles) => {
      setStored((s) => ({ ...s, allocationRoles: roles }));
      notify("Papéis de alocação atualizados");
    },
  };
  return value;
}
