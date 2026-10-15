"use client";
import Link from "next/link";
import { Flag } from "lucide-react";
import { padMilestone } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { Select } from "@/shared/ui/Select";
import type { ServiceCycle } from "@/modules/delivery/domain/services";

type Milestone = { n: number; name: string };

export function MilestoneChip({
  cycle,
  milestone,
  planMilestones,
  onLink,
}: {
  cycle: ServiceCycle;
  milestone?: Milestone;
  planMilestones: Milestone[];
  onLink: (n: number) => void;
}) {
  if (cycle.milestone)
    return (
      <Link
        href={paths.clientPlan(cycle.company, undefined, cycle.milestone)}
        className="inline-flex items-center gap-1.5 text-ink hover:text-blue"
      >
        <Flag className="h-3.5 w-3.5 text-blue" />
        {padMilestone(cycle.milestone)}
        {milestone ? ` · ${milestone.name}` : ""}
      </Link>
    );
  if (planMilestones.length)
    return (
      <span className="inline-flex max-w-full items-center gap-2">
        <Select
          label="Vincular a um marco do plano"
          size="compact"
          placeholder="Vincular a um marco"
          className="max-w-[260px]"
          value=""
          onValueChange={(value) => {
            if (value) onLink(Number(value));
          }}
          options={planMilestones.map((item) => ({
            value: String(item.n),
            label: `${padMilestone(item.n)} · ${item.name}`,
          }))}
        />
      </span>
    );
  return <span className="text-muted">Sem marco do plano</span>;
}
