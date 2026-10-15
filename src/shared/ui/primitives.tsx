import type { HealthFlag } from "@/modules/clients/domain/models";
import type { DeliveryStatus } from "@/modules/delivery/domain/models";
import type { AlertSeverity } from "@/modules/workspace/domain/models";
import { cn } from "@/shared/lib/cn";
import { healthTone } from "@/shared/lib/format";
import { Popover } from "@base-ui/react/popover";
import { Badge, Dot, popupClass, type Tone } from "@g4ai/ds";
import type { ReactNode } from "react";

/**
 * Primitivos visuais. A base vem do G4OS-DS (`@g4ai/ds`); aqui ficam só os
 * que traduzem conceitos do Delivery (status de tarefa, saúde, severidade).
 */
export {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Card,
  CardAction,
  Empty,
  Field,
  FilterChip,
  IconButton,
  Meter,
  Metric,
  Page,
  Section,
  StatCell,
  StatGrid,
} from "@g4ai/ds";

const statusMap: Record<DeliveryStatus, { label: string; tone: Tone }> = {
  fila: { label: "A fazer", tone: "neutral" },
  "em-curso": { label: "Em andamento", tone: "warn" },
  revisao: { label: "Revisão", tone: "warn" },
  entregue: { label: "Concluída", tone: "ok" },
  bloqueado: { label: "Bloqueada", tone: "bad" },
};

export function StatusBadge({ status }: { status: DeliveryStatus }) {
  const s = statusMap[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const flagTone: Record<HealthFlag, Tone> = { green: "ok", yellow: "warn", red: "bad" };

export function HealthDot({ flag }: { flag: HealthFlag }) {
  return <Dot tone={flagTone[flag]} />;
}

/**
 * Health with its explanation: dot, label and score, and a popover that lists
 * every deduction. Colour never appears without the reason behind it.
 */
export function HealthBadge({
  health,
  compact = false,
  className,
}: {
  health: {
    flag: HealthFlag;
    score: number;
    reasons: { code: string; label: string; points: number; severity: string }[];
    summary?: string;
    limit?: string;
  };
  compact?: boolean;
  className?: string;
}) {
  const label =
    health.flag === "green"
      ? "Saudável"
      : health.flag === "yellow"
        ? "Atenção"
        : "Crítica";
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Saúde ${label}, ${health.score} de 100. Ver motivos`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md text-control text-muted hover:bg-soft data-popup-open:bg-soft",
          compact ? "px-1 py-0.5" : "px-1.5 py-1",
          className,
        )}
      >
        <HealthDot flag={health.flag} />
        {!compact && <span>{label}</span>}
        <span className="tabular-nums text-caption">{health.score}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} collisionPadding={8} className="z-[100]">
          <Popover.Popup className={cn(popupClass, "w-[300px] max-w-[calc(100vw-16px)] p-4")}>
            <Popover.Title className="flex items-center justify-between gap-3 text-control font-semibold">
              <span className="inline-flex items-center gap-2">
                <HealthDot flag={health.flag} />
                Saúde {label.toLowerCase()}
              </span>
              <span className="tabular-nums text-muted">{health.score}/100</span>
            </Popover.Title>
            <Popover.Description className="mt-1 text-caption text-muted">
              Por que esta cor
            </Popover.Description>
            {health.reasons.length ? (
              <ul className="mt-3 space-y-1.5 text-label">
                {health.reasons.map((r) => (
                  <li key={r.code} className="flex items-start justify-between gap-3">
                    <span className="inline-flex min-w-0 items-start gap-2">
                      <span className="mt-1.5">
                        <Dot tone={r.severity === "critical" ? "bad" : "warn"} />
                      </span>
                      <span>{r.label}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted">{r.points}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-label text-muted">
                Sem bloqueios, atrasos ou pendências operacionais.
              </p>
            )}
            {health.limit && <p className="mt-3 text-caption text-muted">{health.limit}</p>}
            <p className="mt-3 border-t border-line pt-2 text-meta text-muted">
              Calculada a partir de tarefas, ciclos e alertas.
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const severityTone: Record<AlertSeverity, Tone> = {
  critico: "bad",
  atencao: "warn",
  info: "neutral",
};

export function SeverityDot({ severity }: { severity: AlertSeverity }) {
  return <Dot tone={severityTone[severity]} />;
}

export function Health({ value }: { value: number }) {
  const tone = healthTone(value);
  const color =
    tone === "ok" ? "text-ok" : tone === "warn" ? "text-amber" : "text-rose";
  return <span className={cn("tabular-nums", color)}>{value}</span>;
}

export function CardStack({
  children,
  kicker,
  className,
}: {
  children: ReactNode;
  kicker?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {kicker && <div className="px-3 py-2 text-control font-medium">{kicker}</div>}
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function Panel({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={cn(padded && "py-1", className)}>{children}</div>;
}
