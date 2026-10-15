"use client";
import { clientEntry } from "@/shared/infrastructure/client-entry";
import Link from "next/link";
import { Bell, Paperclip } from "lucide-react";
import { formatDateTime } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { Drawer } from "@/shared/ui/Drawer";
import { Avatar, HealthDot, SeverityDot } from "@/shared/ui/primitives";
import type { Company } from "@/modules/clients/domain/models";
import type { ProgramEvent } from "@/modules/engagement/domain/models";
import type { Alert } from "@/modules/workspace/domain/models";
import { useAlertQueue } from "@/modules/workspace/presentation/useAlertQueue";
import { useAlerts } from "@/modules/workspace/presentation/useAlerts";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import type { ClientDocument } from "@/modules/documents/domain/models";
import { initials, personOf } from "./helpers";

export function ClientDrawer({
  open,
  onClose,
  client,
  team,
  nextEvent,
  files,
}: {
  open: boolean;
  onClose: () => void;
  client?: Company;
  team: string[];
  nextEvent?: ProgramEvent;
  files: ClientDocument[];
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={client?.name ?? "Cliente"}
      kicker="Atalho desta conversa"
    >
      {client && (
        <div className="space-y-5">
          <Link
            href={clientEntry(client.slug)}
            className="flex items-center gap-2 hover:underline"
          >
            <HealthDot flag={client.healthFlag} />
            <span className="font-medium">{client.name}</span>
          </Link>
          {team.length > 0 && (
            <div>
              <div className="mb-1.5 text-[12px] text-muted">
                Equipe neste cliente
              </div>
              <ul className="space-y-4">
                {team.map((n) => {
                  const p = personOf(n);
                  return (
                    <li key={n} className="flex items-center gap-3 text-[13.5px]">
                      <Avatar initials={initials(n)} size="md" />
                      <span className="min-w-0 leading-snug">
                        <span className="block font-medium">{n}</span>
                        {p?.role && (
                          <span className="mt-1 block text-[12px] text-muted">
                            {p.role}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {nextEvent && (
            <div>
              <div className="text-[12px] text-muted">Próximo evento</div>
              <Link
                href={paths.clientAgenda(client.slug)}
                className="mt-1 block text-[13.5px] font-medium hover:underline"
              >
                {nextEvent.title}
              </Link>
              <div className="text-[12.5px] text-muted">
                {formatDateTime(nextEvent.startsAt)} · {nextEvent.place}
              </div>
            </div>
          )}
          {open && <ClientAlerts company={client.slug} />}
          {files.length > 0 && (
            <div>
              <div className="mb-2 text-[12px] text-muted">Documentos</div>
              <ul className="space-y-1.5">
                {files.map((f) => (
                  <li key={f.id}>
                    <Link
                      href={paths.clientDocuments(client.slug)}
                      className="flex items-center gap-2 text-[13px] hover:underline"
                    >
                      <Paperclip className="h-3.5 w-3.5 text-muted" />
                      <span className="truncate">{f.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function ClientAlerts({ company }: { company: string }) {
  const { mode, resolved } = useSyncStatus();
  if (!resolved) return null;
  return mode === "remote"
    ? <RemoteClientAlerts company={company} />
    : <LocalClientAlerts company={company} />;
}

function RemoteClientAlerts({ company }: { company: string }) {
  const { data, error, retry } = useAlertQueue(company);
  return <AlertPreview alerts={(data ?? []).slice(0, 3)} error={error} retry={retry} />;
}

function LocalClientAlerts({ company }: { company: string }) {
  const { alerts } = useAlerts(company);
  return <AlertPreview alerts={alerts.slice(0, 3)} />;
}

function AlertPreview({ alerts, error, retry }: {
  alerts: Alert[]; error?: string | null; retry?: () => void;
}) {
  if (error) return <div role="alert" className="text-[12.5px] text-rose">
    {error} <button type="button" onClick={retry} className="underline">Tentar novamente</button>
  </div>;
  if (!alerts.length) return null;
  return <div>
    <div className="mb-2 flex items-center gap-1.5 text-[12px] text-muted">
      <Bell className="h-3.5 w-3.5" />
      Alertas
    </div>
    <ul className="space-y-2">
      {alerts.map(alert => <li key={alert.id} className="flex items-start gap-2 text-[13px]">
        <span className="mt-1.5"><SeverityDot severity={alert.severity} /></span>
        {alert.title}
      </li>)}
    </ul>
  </div>;
}
