import type { DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';

export type ClientPlanClaimHead = {
  authority_generation: string; source_revision: number; source_incarnation: string;
  projection_generation: string; expected_claims: number; actual_claims: number;
};

/** Match partitionClientDelivery: ownership uses raw maps and extra tasks,
 * including removed tasks, rather than effective patches or seed projection. */
export function deliveryPlanClaims(snapshot: Partial<DeliverySnapshot>, company: string): string[] {
  const ids = new Set<string>();
  const selected = snapshot.companyJourney?.[company];
  if (selected) ids.add(selected);
  for (const task of snapshot.extraTasks ?? [])
    if (task.company === company && task.journeyId) ids.add(task.journeyId);
  return [...ids].sort();
}

export async function readClientPlanClaimHead(db: D1Database, workspace: string, company: string) {
  return db.prepare(`SELECT h.authority_generation,h.source_revision,h.source_incarnation,
      h.projection_generation,h.expected_claims,
      (SELECT COUNT(*) FROM delivery_client_plan_claims p
        WHERE p.workspace_id=h.workspace_id AND p.projection_generation=h.projection_generation
          AND p.company=h.company) AS actual_claims
    FROM delivery_client_plan_claim_heads h
    WHERE h.workspace_id=? AND h.company=?`).bind(workspace, company).first<ClientPlanClaimHead>();
}

/** Certify absence across every current client, including raw task references
 * to plans which have never been materialized. The caller must still guard the
 * observed compatibility version in its write batch and check enrollment
 * claims from the guarded clients document. */
export async function unclaimedPrivatePlan(
  db: D1Database, workspace: string, company: string, planId: string,
  compatibilityVersion: number,
): Promise<boolean> {
  const row = await db.prepare(`SELECT m.expected_clients AS expected,
      m.expected_map_order AS expected_map,
      (SELECT COUNT(*) FROM delivery_client_map_order o
        WHERE o.workspace_id=m.workspace_id AND o.generation=m.generation) AS actual_map,
      (SELECT COUNT(*) FROM delivery_client_map_order o
        WHERE o.workspace_id=m.workspace_id AND o.generation=m.generation
          AND o.kind='productPlans' AND o.id=?) AS existing_plan,
      COUNT(s.company) AS clients,
      SUM(CASE WHEN h.company IS NOT NULL AND
        h.authority_generation=m.generation AND h.source_revision=s.revision AND
        h.source_incarnation=s.incarnation AND h.expected_claims=(
          SELECT COUNT(*) FROM delivery_client_plan_claims p
          WHERE p.workspace_id=h.workspace_id
            AND p.projection_generation=h.projection_generation AND p.company=h.company)
        THEN 1 ELSE 0 END) AS certified,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM delivery_client_plan_claims p
        WHERE p.workspace_id=h.workspace_id
          AND p.projection_generation=h.projection_generation
          AND p.company=h.company AND p.plan_id=? AND p.company<>?
      ) THEN 1 ELSE 0 END) AS foreign_claims
    FROM delivery_client_shadow_meta m
    LEFT JOIN delivery_client_snapshots s ON s.workspace_id=m.workspace_id
      AND s.generation=m.generation
    LEFT JOIN delivery_client_plan_claim_heads h ON h.workspace_id=s.workspace_id
      AND h.company=s.company
    WHERE m.workspace_id=? AND m.mode='active' AND m.compatibility_version=?
    GROUP BY m.workspace_id`).bind(planId, planId, company, workspace, compatibilityVersion)
    .first<{ expected: number; expected_map: number; actual_map: number;
      existing_plan: number; clients: number; certified: number; foreign_claims: number }>();
  return !!row && row.clients === row.expected && row.certified === row.expected &&
    row.actual_map === row.expected_map && row.existing_plan === 0 && row.foreign_claims === 0;
}

/** Keep a previously certified projection current in the slice's D1 batch.
 * A missing, stale, or over-budget head remains stale and forces read fallback. */
export function clientPlanClaimStatements(
  db: D1Database, workspace: string, company: string, generation: string,
  oldRevision: number, incarnation: string,
  before: Partial<DeliverySnapshot>, after: Partial<DeliverySnapshot>,
  head: ClientPlanClaimHead | null, budget: number,
  observedBefore?: ReadonlySet<string>,
): D1PreparedStatement[] {
  if (!head || head.authority_generation !== generation ||
      head.source_revision !== oldRevision || head.source_incarnation !== incarnation ||
      head.actual_claims !== head.expected_claims || budget < 1) return [];
  const prior = new Set(deliveryPlanClaims(before, company));
  if (prior.size !== head.expected_claims) return [];
  if (observedBefore && (observedBefore.size !== prior.size ||
      [...prior].some(id => !observedBefore.has(id)))) return [];
  const next = new Set(deliveryPlanClaims(after, company));
  const statements: D1PreparedStatement[] = [];
  for (const planId of prior) if (!next.has(planId))
    statements.push(db.prepare(`DELETE FROM delivery_client_plan_claims
      WHERE workspace_id=? AND projection_generation=? AND company=? AND plan_id=?`)
      .bind(workspace, head.projection_generation, company, planId));
  for (const planId of next) if (!prior.has(planId))
    statements.push(db.prepare(`INSERT INTO delivery_client_plan_claims
      (workspace_id,projection_generation,company,plan_id) VALUES(?,?,?,?)`)
      .bind(workspace, head.projection_generation, company, planId));
  if (statements.length + 1 > budget) return [];
  statements.push(db.prepare(`UPDATE delivery_client_plan_claim_heads SET
      source_revision=?,expected_claims=?,updated_at=?
    WHERE workspace_id=? AND company=? AND authority_generation=?
      AND source_revision=? AND source_incarnation=? AND projection_generation=?`)
    .bind(oldRevision + 1, next.size, new Date().toISOString(), workspace, company,
      generation, oldRevision, incarnation, head.projection_generation));
  return statements;
}
