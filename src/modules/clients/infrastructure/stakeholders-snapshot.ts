import { defaultInfluence, type Stakeholder } from "../domain/stakeholders.ts";
import { companies } from "./seed.ts";
import { meetings } from "../../engagement/infrastructure/seed.ts";
import { people } from "../../workspace/infrastructure/seed.ts";
import { normalizeContactPoints } from "../../../shared/lib/contact-points.ts";
import { migrateStakeholderContacts } from "../../../shared/infrastructure/migration.ts";
const seedStakeholders: Stakeholder[] = companies.flatMap((company) => {
  const ids = new Set([
    company.sponsorId,
    ...meetings
      .filter((m) => m.company === company.slug)
      .flatMap((m) => m.attendeeIds),
  ]);
  return people
    .filter((p) => p.org === "client" && ids.has(p.id))
    .map((p) => ({
      ...p,
      company: company.slug,
      org: "client" as const,
      area: "",
      email: "",
      emails: [],
      phone: "",
      phones: [],
      accountRole:
        p.id === company.sponsorId
          ? ("patrocinador" as const)
          : ("usuario" as const),
      primary: p.id === company.sponsorId,
      active: true,
      notes: "",
      stance: "desconhecido" as const,
      influence: defaultInfluence(
        p.id === company.sponsorId ? "patrocinador" : "usuario",
      ),
    }));
});
/** Records saved before the relationship fields existed get the same defaults. */
export function withRelationshipDefaults(s: Stakeholder): Stakeholder {
  return {
    ...normalizeContactPoints(s),
    stance: s.stance ?? "desconhecido",
    influence: s.influence ?? defaultInfluence(s.accountRole),
  };
}
export const STAKEHOLDERS_INITIAL: { contacts: Stakeholder[] } = { contacts: seedStakeholders };

export type StakeholdersSnapshot = { contacts: Stakeholder[] };
export function projectStakeholders(state: StakeholdersSnapshot = STAKEHOLDERS_INITIAL) { return migrateStakeholderContacts(state).contacts.map((contact) => withRelationshipDefaults(contact as Stakeholder)); }
