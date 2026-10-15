import type { Person } from "../../workspace/domain/models.ts";
import type { Stakeholder } from "../../clients/domain/stakeholders.ts";

import { phoneKey } from "../../../shared/lib/phone.ts";
import { contactPhones } from "../../../shared/lib/contact-points.ts";
export { phoneKey } from "../../../shared/lib/phone.ts";

export function participantFor(
  number: string,
  members: Person[],
  contacts: Stakeholder[],
  company: string,
) {
  const key = phoneKey(number);
  if (!key) return null;
  const matches = [
    ...members.filter(
      (p) => p.org === "praxis" && contactPhones(p).includes(key),
    ),
    ...contacts.filter(
      (p) => p.company === company && contactPhones(p).includes(key),
    ),
  ];
  // Ambiguity must be resolved by a person, never by array order.
  return matches.length === 1 ? matches[0] : null;
}
