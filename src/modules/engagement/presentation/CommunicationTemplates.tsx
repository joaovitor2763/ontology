"use client";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import {
  channelLabelOf,
  interpolate,
  missingVariables,
  templateVariableLabel,
} from "@/modules/engagement/domain/communication";
import type {
  CommunicationChannel,
  CommunicationTemplate,
} from "@/modules/engagement/domain/models";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { cn } from "@/shared/lib/cn";
import { NOW, formatDate } from "@/shared/lib/format";
import { Modal } from "@/shared/ui/Dialog";
import { areaClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Badge, Button } from "@/shared/ui/primitives";
import { Check, Copy, StickyNote } from "lucide-react";
import { useMemo, useRef, useState } from "react";

/**
 * Picks a message template, compares its variations and fills the client's
 * data. Copy goes to the clipboard or becomes an internal note; nothing is sent.
 */
export function CommunicationTemplates({
  company,
  open,
  onClose,
  onSaveNote,
  onResetSave,
}: {
  company: string;
  open: boolean;
  onClose: () => void;
  /** Saves the final text as an internal note of the conversation, when available. */
  onSaveNote?: (text: string) => void|Promise<string|void>;
  onResetSave?:()=>void;
}) {
  const { allTemplates } = useEngagementState();
  const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState("");
  const pendingText=useRef<string|null>(null),locked=useRef(false);
  async function saveNote(){
    if(locked.current||!onSaveNote)return;locked.current=true;setSaving(true);setSaveError("");pendingText.current??=text;
    try{const error=await onSaveNote(pendingText.current);if(error)setSaveError(error);else{pendingText.current=null;onClose();}}
    catch(e){setSaveError(e instanceof Error?e.message:"Não foi possível confirmar a nota.");}
    finally{locked.current=false;setSaving(false);}
  }
  const { clientBySlug, assigned } = useClientsState();
  const { forCompany } = useStakeholders();
  const { resolve } = useTeam();
  const [channel, setChannel] = useState<CommunicationChannel>("whatsapp");
  const [templateId, setTemplateId] = useState("");
  const [variationId, setVariationId] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const client = clientBySlug(company);
  const contact = forCompany(company).find((s) => s.active && s.primary);
  const lead = client ? resolve(assigned(client).leadId) : undefined;
  const values = useMemo(
    () => ({
      cliente: client?.name,
      contato: contact?.name.split(" ")[0],
      responsavel: lead?.name,
      data: formatDate(NOW),
      hora: "",
      link: "",
      proximo_passo: client?.nextMilestone,
      documentos: "",
    }),
    [client, contact, lead],
  );
  const templates = allTemplates.filter((t) => t.channel === channel);
  const template: CommunicationTemplate | undefined =
    templates.find((t) => t.id === templateId) ?? templates[0];
  const variation =
    template?.variations.find((v) => v.id === variationId) ??
    template?.variations.find((v) => v.id === template.defaultVariationId) ??
    template?.variations[0];
  const interpolated = variation ? interpolate(variation.body, values) : "";
  const text = draft ?? interpolated;
  const missing = variation ? missingVariables(variation.body, values) : [];

  /** Any change of channel, template or variation discards the edited text. */
  function reset(next: {
    channel?: CommunicationChannel;
    templateId?: string;
    variationId?: string;
  }) {
    if (next.channel !== undefined) setChannel(next.channel);
    if (next.templateId !== undefined) setTemplateId(next.templateId);
    if (next.variationId !== undefined) setVariationId(next.variationId);
    setDraft(null);
    setCopied(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(
        channel === "email" && variation?.subject
          ? `Assunto: ${interpolate(variation.subject, values)}\n\n${text}`
          : text,
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={()=>{if(!locked.current){onResetSave?.();pendingText.current=null;setSaveError("");onClose();}}}
      size="lg"
      kicker={client?.name}
      title="Modelos de mensagem"
      description="Escolha o modelo e a variação, ajuste o texto e copie. Nada é enviado por aqui."
      footer={
        <>
          {saveError&&<div className="w-full text-sm"><p role="alert" className="text-rose">{saveError}</p><button disabled={saving} className="mt-1 underline" onClick={()=>{onResetSave?.();pendingText.current=null;setSaveError("");}}>Revisar nota</button></div>}
          {onSaveNote && (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving||!text.trim()}
              onClick={()=>void saveNote()}
            >
              <StickyNote className="h-3.5 w-3.5" />
              {saving?"Salvando…":saveError?"Verificar nota":"Salvar como nota interna"}
            </Button>
          )}
          <Button size="sm" disabled={!text.trim()} onClick={copy}>
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </>
      }
    >
      <fieldset disabled={saving||!!saveError} className="min-w-0">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Canal"
              value={channel}
              onValueChange={(v) =>
                reset({
                  channel: v as CommunicationChannel,
                  templateId: "",
                  variationId: "",
                })
              }
              options={(["whatsapp", "email"] as CommunicationChannel[]).map(
                (c) => ({
                  value: c,
                  label: channelLabelOf[c],
                }),
              )}
            />
            <Select
              label="Modelo"
              value={template?.id ?? ""}
              onValueChange={(v) => reset({ templateId: v, variationId: "" })}
              options={templates.map((t) => ({
                value: t.id,
                label: t.name,
                description: t.milestone ? `Marco ${t.milestone}` : undefined,
              }))}
            />
          </div>
          {template && (
            <>
              <p className="text-[12.5px] leading-relaxed text-muted">
                {template.objective}
              </p>
              <div
                className="flex flex-wrap gap-1 text-[12.5px]"
                role="tablist"
                aria-label="Variações"
              >
                {template.variations.map((v, i) => {
                  const on = v.id === variation?.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => reset({ variationId: v.id })}
                      className={cn(
                        "rounded-lg px-2.5 py-1.5 ring-1",
                        on
                          ? "bg-ink text-on-ink ring-ink"
                          : "bg-surface text-ink-soft ring-line hover:bg-soft",
                      )}
                    >
                      V{i + 1} · {v.approach}
                      <span className="ml-1.5 opacity-70">{v.score}</span>
                    </button>
                  );
                })}
              </div>
              {variation?.subject && (
                <p className="text-[13px]">
                  <span className="text-muted">Assunto: </span>
                  {interpolate(variation.subject, values)}
                </p>
              )}
              {variation?.headline && !variation.subject && (
                <p className="text-[13px] font-medium">
                  {interpolate(variation.headline, values)}
                </p>
              )}
              <textarea
                value={text}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                className={areaClass}
                aria-label="Texto da mensagem"
              />
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                <span>Chamada: {variation?.cta}</span>
                {draft !== null && (
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    className="text-blue hover:underline"
                  >
                    Restaurar o modelo
                  </button>
                )}
              </div>
              {missing.length > 0 && (
                <p className="text-[12px] text-amber">
                  Preencha antes de enviar:{" "}
                  {missing.map((m) => templateVariableLabel[m] ?? m).join(", ")}
                  .
                </p>
              )}
            </>
          )}
          {!template && (
            <p className="text-[13px] text-muted">
              Nenhum modelo neste canal ainda.
            </p>
          )}
        </div>
        {variation && (
          <aside className="space-y-4 rounded-xl border border-line p-4 text-[12.5px]">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-medium">Por que esta variação</span>
                <Badge tone={variation.score >= 85 ? "ok" : "neutral"}>
                  {variation.score}
                </Badge>
              </div>
              <p className="mt-1.5 leading-relaxed text-muted">
                {variation.reasoning}
              </p>
            </div>
            <dl className="space-y-1.5">
              {(
                [
                  ["canal", "Adequação ao canal"],
                  ["clarezaCta", "Clareza da chamada"],
                  ["engajamento", "Engajamento"],
                  ["gancho", "Gancho"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <dt className="w-32 shrink-0 text-muted">{label}</dt>
                  <dd className="flex flex-1 items-center gap-2">
                    <span className="h-1 flex-1 rounded-full bg-line">
                      <span
                        className="block h-1 rounded-full bg-accent"
                        style={{ width: `${variation.scoreBreakdown[key]}%` }}
                      />
                    </span>
                    <span className="w-6 text-right tabular-nums">
                      {variation.scoreBreakdown[key]}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <div>
              <span className="font-medium">Variáveis</span>
              <ul className="mt-1.5 flex flex-wrap gap-1">
                {template?.variables.map((v) => (
                  <li
                    key={v}
                    className={cn(
                      "rounded-md px-1.5 py-0.5 ring-1",
                      values[v as keyof typeof values]
                        ? "bg-soft text-ink-soft ring-line"
                        : "bg-amber-soft/50 text-amber ring-amber/30",
                    )}
                    title={templateVariableLabel[v] ?? v}
                  >
                    {`{{${v}}}`}
                  </li>
                ))}
              </ul>
            </div>
            {/* TODO: editor de modelos em Configurações; por ora os modelos vêm do seed e de edições salvas. */}
          </aside>
        )}
      </div>
      </fieldset>
    </Modal>
  );
}
