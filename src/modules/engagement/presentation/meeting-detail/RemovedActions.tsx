"use client";
import Link from "next/link";
import { Button } from "@/shared/ui/primitives";
import { paths } from "@/shared/lib/routes";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import type { Meeting } from "@/modules/engagement/domain/models";

export function RemovedActions({
  meeting,
  removed,
  onRestore,
}: {
  meeting: Meeting;
  removed: boolean;
  onRestore: (actionId: string | undefined) => void;
}) {
  const { can } = usePermissions();
  if (!meeting.actions.some((a) => a.removedAt)) return null;
  return (
    <section className="mt-6 rounded-xl border border-line p-4">
      <h2 className="font-medium">Ações removidas</h2>
      <ul className="mt-3 space-y-3">
        {meeting.actions
          .filter((a) => a.removedAt)
          .map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <span className="text-sm">
                {a.text}
                {a.deliveryId && (
                  <Link
                    className="ml-2 text-blue"
                    href={paths.clientDelivery(meeting.company, a.deliveryId)}
                  >
                    Ver tarefa
                  </Link>
                )}
              </span>
              {!removed && can("reunioes.agendar", meeting.company) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRestore(a.id)}
                >
                  Restaurar ação
                </Button>
              )}
            </li>
          ))}
      </ul>
    </section>
  );
}
