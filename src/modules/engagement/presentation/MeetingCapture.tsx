"use client";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { Drawer } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { STEPS } from "./meeting-capture/shared";
import { useCaptureDraft } from "./meeting-capture/useCaptureDraft";
import { ContextStep } from "./meeting-capture/ContextStep";
import { PainsStep } from "./meeting-capture/PainsStep";
import { HypothesesStep } from "./meeting-capture/HypothesesStep";
import { SolutionsStep } from "./meeting-capture/SolutionsStep";
import { DecisionsStep } from "./meeting-capture/DecisionsStep";

/**
 * Registers a meeting that already happened, in five steps: context, pains,
 * hypotheses (what the conversation confirmed, contradicted or refined),
 * solutions (each tied to a pain, with a hypothesis) and decisions. Everything is
 * saved together at the end; cancelling saves nothing. The notes field is the
 * slot an AI extractor will read later to suggest pains and decisions.
 */
export function MeetingCapture({
  defaultCompany,
  open,
  onClose,
}: {
  defaultCompany?: string;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <CaptureWizard defaultCompany={defaultCompany} onClose={onClose} />;
}

function CaptureWizard({
  defaultCompany,
  onClose,
}: {
  defaultCompany?: string;
  onClose: () => void;
}) {
  const draft = useCaptureDraft({ defaultCompany, onClose });
  const { step, go, error, saving, pending } = draft;
  return (
    <Drawer
      open
      onClose={() => {
        if (!draft.locked.current) onClose();
      }}
      title="Registrar reunião realizada"
      kicker={`Passo ${step + 1} de ${STEPS.length} · ${STEPS[step]}`}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={onClose}
          >
            Cancelar
          </Button>
          {pending && error && !saving && (
            <Button type="button" variant="ghost" onClick={draft.review}>
              Revisar captura
            </Button>
          )}
          <span className="flex gap-2">
            {step > 0 && (
              <Button
                type="button"
                variant="ghost"
                disabled={saving || pending}
                onClick={() => go(step - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Voltar
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={() => go(step + 1)}>
                Avançar
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={draft.finish}
                disabled={saving || !draft.title.trim()}
              >
                <Check className="h-3.5 w-3.5" />
                {saving
                  ? "Salvando…"
                  : pending
                    ? "Verificar reunião"
                    : "Salvar reunião"}
              </Button>
            )}
          </span>
        </div>
      }
    >
      <fieldset disabled={saving || pending} className="min-w-0">
        <ol
          className="mb-6 flex items-center gap-1 text-[11px]"
          aria-label="Etapas"
        >
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => (i < step ? go(i) : undefined)}
                aria-current={i === step ? "step" : undefined}
                className={cn(
                  "rounded-md px-2 py-1",
                  i === step
                    ? "bg-ink font-medium text-on-ink"
                    : i < step
                      ? "bg-soft text-ink"
                      : "text-muted",
                )}
              >
                {i + 1}. {label}
              </button>
              {i < STEPS.length - 1 && <span className="text-line-strong">›</span>}
            </li>
          ))}
        </ol>

        {step === 0 && <ContextStep draft={draft} />}
        {step === 1 && <PainsStep draft={draft} />}
        {step === 2 && <HypothesesStep draft={draft} />}
        {step === 3 && <SolutionsStep draft={draft} />}
        {step === 4 && <DecisionsStep draft={draft} />}

        {error && (
          <p role="alert" className="mt-4 text-[13px] text-rose">
            {error}
          </p>
        )}
      </fieldset>
    </Drawer>
  );
}
