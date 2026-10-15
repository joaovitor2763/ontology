import { applyTaskOverride } from "../domain/task-overrides.ts";
import type { Delivery, DeliveryStatus } from "../domain/models";
import type { TaskOverride } from "../domain/task-overrides.ts";
/** The same projection feeds the portfolio, client workspace and cycle progress. */
export function selectDeliveries(
  records: Delivery[],
  company?: string,
  statusMap: Record<string, DeliveryStatus> = {},
  patches: Record<string, TaskOverride> = {},
): Delivery[] {
  const seen = new Set<string>();
  return records
    .filter((record) => {
      if ((company && record.company !== company) || seen.has(record.id) || patches[record.id]?.removed)
        return false;
      seen.add(record.id);
      return true;
    })
    .map((record) => ({
      ...applyTaskOverride(record, patches[record.id]),
      status:
        statusMap[record.id] ?? patches[record.id]?.status ?? record.status,
    }));
}
