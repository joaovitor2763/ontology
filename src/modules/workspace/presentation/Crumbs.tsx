"use client";
import { useCatalog } from "@/modules/catalog/presentation/catalog";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";

import { meetings } from "@/modules/engagement/infrastructure/seed";
import { Breadcrumb, type Crumb } from "@g4ai/ds";
import { usePathname } from "next/navigation";

import { padMilestone } from "@/shared/lib/format";
import { clientSectionLabel, glossary, paths } from "@/shared/lib/routes";

/**
 * Trilha e barra de contexto são as do DS (`Breadcrumb`, `ContextBar`: só
 * ancestrais, `ContextBar` para páginas de registro). Aqui fica só a derivação
 * dos ancestrais a partir do endereço e dos documentos.
 */
export { Breadcrumb, ContextBar, type Crumb } from "@g4ai/ds";

/**
 * Ancestors of the current page, never the page itself: the title says where
 * you are, the trail says how you got there. Pages whose only ancestor is the
 * sidebar item (global lists, the home) get no trail at all.
 */
export function useCrumbs(): Crumb[] {
  const path = usePathname();
  const { extraMeetings } = useEngagementState();
  const { clientBySlug } = useClientsState();
  const { journeyOf } = useCatalog();
  const { cycles, statusMap, extraTasks, taskPatches } = useDeliveryState();
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return [];

  if (parts[0] === "clientes" && parts[1]) {
    const client = clientBySlug(parts[1]);
    const items: Crumb[] = [{ label: glossary.clients, href: paths.clients }];
    if (!parts[2]) return items;
    items.push({ label: client?.name ?? parts[1], href: paths.client(parts[1]) });
    const milestoneCrumb = (n: number): Crumb => {
      const m = client
        ? journeyOf(client).milestones.find((item) => item.n === n)
        : undefined;
      return {
        label: `${padMilestone(n)}${m ? ` · ${m.name}` : ""}`,
        href: paths.clientPlan(parts[1], undefined, n),
      };
    };
    if (parts[2] === "ciclos" && parts[3]) {
      const cycle = cycles.find((c) => c.id === parts[3]);
      items.push({
        label: clientSectionLabel.plano,
        href: paths.clientPlan(parts[1]),
      });
      if (cycle?.milestone) items.push(milestoneCrumb(cycle.milestone));
      return items;
    }
    if (parts[2] === "entregas" && parts[3]) {
      const task = deliveriesFor(parts[1], statusMap, extraTasks, taskPatches).find(
        (d) => d.id === parts[3],
      );
      items.push({
        label: task?.kind === "request" ? clientSectionLabel.solicitacoes : clientSectionLabel.entregas,
        href: paths.clientDeliveries(
          parts[1],
          task?.kind === "request" ? "solicitacoes" : undefined,
        ),
      });
      const cycle = task
        ? cycles.find(
            (c) => c.company === parts[1] && c.taskIds.includes(task.id),
          )
        : undefined;
      if (cycle)
        items.push({ label: cycle.name, href: paths.clientCycle(parts[1], cycle.id) });
      else if (task?.milestone) items.push(milestoneCrumb(task.milestone));
      return items;
    }
    return items;
  }

  if (parts[0] === "reunioes" && parts[1]) {
    const all = [...meetings, ...extraMeetings];
    const m = all.find((x) => x.id === parts[1]);
    const c = m ? clientBySlug(m.company) : undefined;
    const items: Crumb[] = [{ label: glossary.agenda, href: paths.agenda }];
    if (c) items.push({ label: c.name, href: paths.clientAgenda(c.slug) });
    return items;
  }

  if (parts[0] === "equipe" && parts[1] === "membros" && parts[2])
    return [{ label: glossary.members, href: paths.teamMembers }];

  return [];
}

/**
 * A trilha só tem ancestrais em três formas de endereço; em todo o resto ela é
 * vazia. Descobrir isso montando `useCrumbs` custava quatro documentos — cliente,
 * catálogo, execução e engajamento — em toda página que mostra um cabeçalho,
 * inclusive as que nunca terão trilha. O endereço decide primeiro; os documentos
 * entram só onde há trilha para derivar.
 */
export function Crumbs({ className }: { className?: string }) {
  const parts = usePathname().split("/").filter(Boolean);
  if (parts[0] === "equipe" && parts[1] === "membros" && parts[2])
    return (
      <Breadcrumb
        items={[{ label: glossary.members, href: paths.teamMembers }]}
        className={className}
      />
    );
  if (parts[0] === "reunioes" && parts[1])
    return <MeetingCrumbs className={className} id={parts[1]} />;
  if (parts[0] === "clientes" && parts[1])
    return <DerivedCrumbs className={className} />;
  return null;
}

function MeetingCrumbs({ id, className }: { id: string; className?: string }) {
  const { meetingsIncludingRemoved } = useEngagementState();
  const { clientBySlug } = useClientsState();
  const meeting = meetingsIncludingRemoved.find((item) => item.id === id);
  const client = meeting ? clientBySlug(meeting.company) : undefined;
  return <Breadcrumb className={className} items={[
    { label: glossary.agenda, href: paths.agenda },
    ...(client ? [{ label: client.name, href: paths.clientAgenda(client.slug) }] : []),
  ]} />;
}

function DerivedCrumbs({ className }: { className?: string }) {
  return <Breadcrumb items={useCrumbs()} className={className} />;
}
