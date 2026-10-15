import type { ElementType } from "@/modules/knowledge/domain/models";
import {
  Box,
  Building2,
  ChartNoAxesCombined,
  Database,
  Network,
  ShieldCheck,
  UserRound,
  Workflow,
  Zap,
} from "lucide-react";
const icons = {
  company: Building2,
  area: Network,
  person: UserRound,
  object: Box,
  process: Workflow,
  system: Database,
  rule: ShieldCheck,
  metric: ChartNoAxesCombined,
  action: Zap,
};
export function ElementIcon({
  type,
  className = "h-4 w-4",
}: {
  type: ElementType;
  className?: string;
}) {
  const Icon = icons[type];
  return <Icon className={className} aria-hidden="true" />;
}
