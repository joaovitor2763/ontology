"use client";
import { DatePicker } from "@/shared/ui/DatePicker";

import { useClientLifecycle, ClientLifecycleFeedback } from "@/modules/clients/presentation/useClientLifecycle";
import { ClientIdentityFields } from "@/modules/clients/presentation/ClientIdentityFields";
import { useCatalog } from "@/modules/catalog/presentation/catalog";
import {
  clientStatusLabel,
  healthFlagLabel,
  type ClientStatus,
  type Company,
  type HealthFlag,
} from "@/modules/clients/domain/models";
import {
  serviceModelLabel,
  type ServiceConfig,
} from "@/modules/clients/domain/service-config";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { enrollmentStatusLabel } from "@/modules/clients/domain/product-enrollments";
import {
  CharterFields,
  emptyCharter,
} from "@/modules/clients/presentation/CharterFields";
import { usePlanActivation } from "./usePlanActivation";
import { useServices } from "@/modules/delivery/presentation/state";
import { padMilestone } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { Combobox } from "@/shared/ui/Combobox";
import { areaClass, Drawer, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Checkbox } from "@g4ai/ds";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { Select } from "@/shared/ui/Select";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { clientOperationBaseline, executeClientOperation, operationAttempt, usesRemoteOperations, type OperationAttempt } from "@/shared/infrastructure/operations";
import { notify } from "@/shared/ui/Feedback";
import { hasLegacyExecutionForClient } from "@/modules/delivery/application/plan-schedule";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";

export type SettingsSection =
  "cadastro" | "servico" | "contrato" | "plano" | "recursos";
type Section = SettingsSection;

const sections: { value: Section; label: string }[] = [
  { value: "cadastro", label: "Cadastro" },
  { value: "servico", label: "Serviço" },
  { value: "contrato", label: "Contrato de valor" },
  { value: "plano", label: "Execução" },
  { value: "recursos", label: "Recursos" },
];

/** Everything about one client in one place: registry, contracted service, plan and optional modules. */
export function ServiceSettings({
  company,
  onClose,
  initialSection = "servico",
}: {
  company: string;
  onClose: () => void;
  initialSection?: Section;
}) {
  const router = useRouter();
  const { configFor, saveConfig, storageError, products, cycles, companyJourney } = useServices();
  const { statusMap, extraTasks, taskPatches } = useDeliveryState();
  const { clientBySlug, saveClient, assigned, enrollments } =
    useClientsState();
  const { journeys, journeyOf, milestoneOf } = useCatalog();
  const { activate: activatePlan, validate: validatePlan } = usePlanActivation();
  const record = clientBySlug(company);
  const [section, setSection] = useState<Section>(initialSection);
  const [config, setConfig] = useState<ServiceConfig>(configFor(company));
  const [client, setClient] = useState<Company | undefined>(record);
  const [journeyId, setJourneyId] = useState(
    record ? journeyOf(record).id : "",
  );
  const [milestone, setMilestone] = useState(
    record ? String(milestoneOf(record).n) : "1",
  );
  const [logoBusy, setLogoBusy] = useState(false);
  const [planError, setPlanError] = useState("");
  const [saving, setSaving] = useState(false);
  const lifecycle = useClientLifecycle();
  const submitting = useRef(false);
  const attempt = useRef<OperationAttempt | null>(null);
  const [operationBaseline] = useState(clientOperationBaseline);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const journey = journeys.find((j) => j.id === journeyId);
  const purchases = enrollments.filter((enrollment) => enrollment.company === company);
  const projectedTasks = deliveriesFor(company, statusMap, extraTasks, taskPatches);
  const hasLegacyExecution = hasLegacyExecutionForClient(
    { cycles, tasks: projectedTasks },
    company,
    [companyJourney[company], record?.journeyId],
    purchases.map((enrollment) => enrollment.planId),
  );
  const planChanged =
    record &&
    (journeyId !== journeyOf(record).id ||
      Number(milestone) !== milestoneOf(record).n);
  const archived = record?.status === "encerrado";

  function setClientField<K extends keyof Company>(key: K, value: Company[K]) {
    setClient((c) => (c ? { ...c, [key]: value } : c));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (logoBusy || submitting.current) return;
    if (client?.initials?.trim() && Array.from(client.initials.trim()).length !== 2) {
      setPlanError("Use exatamente dois caracteres para o cliente ou deixe vazio.");
      return;
    }
    const problem = hasLegacyExecution && client ? validatePlan(client, journeyId) : null;
    if (problem) {
      setPlanError(problem);
      return;
    }
    const nextConfig: ServiceConfig = {
      ...config,
      name: config.name.trim(),
      productIds: [
        ...new Set([
          ...(config.productIds ?? []),
          ...(hasLegacyExecution && journey?.productId ? [journey.productId] : []),
        ]),
      ],
    };
    submitting.current = true;
    setSaving(true);
    setPlanError("");
    try {
      if (await usesRemoteOperations()) {
        if (!client) throw new Error("Cliente não encontrado. Atualize a página.");
        const input = {
          client: { ...client, name: client.name.trim() },
          config: nextConfig,
          ...assigned(client),
          journeyId: hasLegacyExecution ? journeyId : "",
          productIds: nextConfig.productIds,
          milestone: hasLegacyExecution ? Number(milestone) || 1 : 1,
        };
        attempt.current = operationAttempt("clients.configure", input, attempt.current);
        await executeClientOperation("clients.configure", input, attempt.current, operationBaseline);
        notify("Cliente atualizado");
      } else {
        if (client && record && JSON.stringify(client) !== JSON.stringify(record))
          saveClient({ ...client, name: client.name.trim() });
        saveConfig(company, nextConfig);
        if (hasLegacyExecution && client && journey && (planChanged || journey.autoCreateCycles))
          await activatePlan(client, journeyId, Number(milestone) || 1);
      }
      onClose();
    } catch (failure) {
      setPlanError(failure instanceof Error ? failure.message : "Não foi possível salvar o cliente. Tente novamente.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={() => { if (!submitting.current && !lifecycle.isBusy()) onClose(); }}
      title="Configurar cliente"
      kicker={record?.name ?? config.name}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            {archived ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={saving || lifecycle.busy}
                onClick={() => {
                  void lifecycle.run("clients.restore", company, onClose);
                }}
              >
                Reativar cliente
              </Button>
            ) : confirmArchive ? (
              <>
                <span>Arquivar este cliente?</span>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={saving || lifecycle.busy}
                  onClick={() => {
                    void lifecycle.run("clients.archive", company, () => { onClose(); router.push(paths.clients); });
                  }}
                >
                  Arquivar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving || lifecycle.busy}
                  onClick={() => setConfirmArchive(false)}
                >
                  Manter
                </Button>
              </>
            ) : (
              <Button
                variant="danger"
                size="sm"
                disabled={saving || lifecycle.busy}
                onClick={() => setConfirmArchive(true)}
              >
                Arquivar cliente
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving || lifecycle.busy}>
              Cancelar
            </Button>
            <Button type="submit" form="service-settings" disabled={logoBusy || saving || lifecycle.busy}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="mb-6">
        <SegmentedControl
          label="Seção da configuração"
          value={section}
          onChange={setSection}
          options={sections}
        />
      </div>
      <form id="service-settings" onSubmit={submit}>
        <fieldset disabled={saving || lifecycle.busy} className="min-w-0">
        <ClientLifecycleFeedback operation={lifecycle} />
        {planError && (
          <p role="alert" className="mb-4 text-sm text-rose">
            {planError}
          </p>
        )}
        {section === "cadastro" && client && (
          <>
            <ClientIdentityFields client={client} onBusy={setLogoBusy} onChange={(patch) => setClient((current) => current ? { ...current, ...patch } : current)} />
            <FieldBlock label="Nome">
              <input
                required
                className={fieldClass}
                value={client.name}
                onChange={(e) => setClientField("name", e.target.value)}
              />
            </FieldBlock>
            <FieldBlock label="Razão social">
              <input
                className={fieldClass}
                value={client.legalName}
                onChange={(e) => setClientField("legalName", e.target.value)}
              />
            </FieldBlock>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_80px]">
              <FieldBlock label="Setor">
                <input
                  className={fieldClass}
                  value={client.sector}
                  onChange={(e) => setClientField("sector", e.target.value)}
                />
              </FieldBlock>
              <FieldBlock label="Cidade">
                <input
                  className={fieldClass}
                  value={client.city}
                  onChange={(e) => setClientField("city", e.target.value)}
                />
              </FieldBlock>
              <FieldBlock label="UF">
                <input
                  className={fieldClass}
                  maxLength={2}
                  value={client.uf}
                  onChange={(e) =>
                    setClientField("uf", e.target.value.toUpperCase())
                  }
                />
              </FieldBlock>
            </div>
            <FieldBlock label="Contrato">
              <input
                className={fieldClass}
                value={client.contract}
                placeholder="Ex.: Consultoria operacional · 12 semanas"
                onChange={(e) => setClientField("contract", e.target.value)}
              />
            </FieldBlock>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldBlock label="Início do contrato">
                <DatePicker label="Início do contrato" className={fieldClass} value={client.startedAt.slice(0, 10)} onValueChange={(next) => setClientField("startedAt", next)} />
              </FieldBlock>
              <FieldBlock label="Situação">
                <Select
                  label="Situação"
                  value={client.status ?? "ativo"}
                  onValueChange={(v) =>
                    setClientField("status", v as ClientStatus)
                  }
                  options={Object.entries(clientStatusLabel).map(
                    ([id, label]) => ({ value: id, label }),
                  )}
                />
              </FieldBlock>
            </div>
            <FieldBlock label="Saúde da relação">
              <Select
                label="Saúde da relação"
                value={client.healthFlag}
                onValueChange={(v) =>
                  setClientField("healthFlag", v as HealthFlag)
                }
                tone={
                  client.healthFlag === "green"
                    ? "ok"
                    : client.healthFlag === "yellow"
                      ? "warn"
                      : "bad"
                }
                options={Object.entries(healthFlagLabel).map(([id, label]) => ({
                  value: id,
                  label,
                }))}
              />
            </FieldBlock>
            <FieldBlock label="Resumo do serviço">
              <textarea
                className={areaClass}
                rows={3}
                value={client.summary}
                onChange={(e) => setClientField("summary", e.target.value)}
              />
            </FieldBlock>
          </>
        )}
        {section === "contrato" && client && (
          <>
            <p className="mb-5 text-[13px] leading-relaxed text-muted">
              O contrato de valor alinha o que o cliente pediu, o que a equipe
              entendeu e como fica quando termina. Toda recomendação equilibra
              tempo, capital e talento.
            </p>
            <CharterFields
              value={{ ...emptyCharter, ...(client.charter ?? {}) }}
              onChange={(next) => setClientField("charter", next)}
            />
          </>
        )}
        {section === "servico" && (
          <>
            <FieldBlock label="Escopo para este cliente">
              <input
                required
                className={fieldClass}
                value={config.name}
                onChange={(e) => setConfig({ ...config, name: e.target.value })}
              />
            </FieldBlock>
            <div className="mb-6 rounded-lg border border-line p-3">
              <h3 className="text-[13px] font-medium">Produtos contratados</h3>
              <p className="mt-1 text-[12px] text-muted">
                Produtos são incluídos e encerrados como contratações, para que versão, execução e histórico permaneçam juntos.
              </p>
              <div className="mt-3 space-y-1 text-[13px]">
                {purchases.map((enrollment) => <p key={enrollment.id}>
                  {products.find((product) => product.id === enrollment.productId)?.name ?? enrollment.productId}
                  <span className="text-muted"> · {enrollmentStatusLabel[enrollment.status]}{enrollment.archivedAt ? " · Arquivada" : ""}</span>
                </p>)}
                {!purchases.length && <p className="text-muted">Nenhum produto contratado.</p>}
              </div>
              <Button className="mt-3" type="button" variant="ghost" onClick={() => { onClose(); router.push(`${paths.clientPlan(company)}?gerenciarContratacoes=1`); }}>Gerenciar contratações</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldBlock label="Modelo de trabalho">
                <Select
                  label="Modelo de trabalho"
                  value={config.model}
                  onValueChange={(v) =>
                    setConfig({ ...config, model: v as ServiceConfig["model"] })
                  }
                  options={Object.entries(serviceModelLabel).map(
                    ([id, label]) => ({ value: id, label }),
                  )}
                />
              </FieldBlock>
              <FieldBlock label="Cadência dos ciclos (semanas)">
                <input
                  type="number"
                  min={1}
                  max={12}
                  className={fieldClass}
                  value={config.cadenceWeeks}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      cadenceWeeks: Math.max(
                        1,
                        Math.min(12, Number(e.target.value) || 1),
                      ),
                    })
                  }
                />
              </FieldBlock>
            </div>
            <p className="text-[12px] leading-relaxed text-muted">
              A cadência sugere o término ao abrir um novo ciclo; ciclos já
              abertos não mudam.
            </p>
          </>
        )}
        {section === "plano" && (
          <>
            {purchases.length > 0 && <>
              <p className="mb-4 text-[13px] leading-relaxed text-muted">
                Cada produto contratado possui sua própria execução, criada a partir da versão comprada. Marcos, ciclos e tarefas são administrados em Plano e ciclos — não há um segundo plano de catálogo para escolher.
              </p>
              <div className="space-y-2">
                {purchases.map((enrollment) => <div key={enrollment.id} className="rounded-lg border border-line px-3 py-2.5 text-[13px]">
                  <span className="font-medium">{products.find((product) => product.id === enrollment.productId)?.name ?? enrollment.productId}</span>
                  <span className="ml-2 text-muted">v{enrollment.productVersion ?? "?"} · {enrollmentStatusLabel[enrollment.status]}{enrollment.archivedAt ? " · Arquivada" : ""}</span>
                </div>)}
              </div>
              <Button type="button" className="mt-4" variant="ghost" onClick={() => { onClose(); router.push(paths.clientPlan(company)); }}>Abrir Plano e ciclos</Button>
            </>}
            {hasLegacyExecution && <div className={purchases.length ? "mt-6 border-t border-line pt-5" : ""}>
              <p className="mb-5 text-[13px] leading-relaxed text-muted">
                Este cliente ainda usa uma execução legada sem contratação identificada. Os controles abaixo permanecem disponíveis até essa execução ser classificada.
              </p>
              <FieldBlock label="Plano legado de referência">
                <Combobox
                  label="Plano legado de referência"
                  className={fieldClass}
                  value={journeyId}
                  onValueChange={(value) => {
                    setJourneyId(value);
                    setMilestone("1");
                  }}
                  options={journeys.map((j) => ({
                    value: j.id,
                    label: j.name,
                    description: `${j.milestones.length} marcos`,
                  }))}
                />
              </FieldBlock>
              <FieldBlock label="Marco atual">
                <Combobox
                  label="Marco atual"
                  className={fieldClass}
                  value={milestone}
                  onValueChange={setMilestone}
                  options={(journey?.milestones ?? []).map((m) => ({
                    value: String(m.n),
                    label: `${padMilestone(m.n)} · ${m.name}`,
                    description: m.stage,
                  }))}
                />
              </FieldBlock>
              {journey?.autoCreateCycles && <p className="mb-3 text-sm text-muted">Ao salvar, somente a execução legada é completada; novas contratações sempre usam o produto.</p>}
              {planChanged && <p className="rounded-lg bg-amber-soft/50 px-3 py-2 text-[12.5px] text-amber">Trocar o plano ou o marco atual reposiciona esta execução legada. Tarefas e ciclos existentes são preservados.</p>}
            </div>}
            {!purchases.length && !hasLegacyExecution && <p className="text-[13px] leading-relaxed text-muted">Nenhuma execução identificada para este cliente. Contrate um produto para criar ciclos e tarefas a partir da versão escolhida.</p>}
          </>
        )}
        {section === "recursos" && (
          <>
            <p className="mb-4 text-[13px] leading-relaxed text-muted">
              Produtos, ciclos, tarefas, agenda, conversas e documentos estão
              sempre disponíveis. Ative a ontologia quando fizer parte do serviço.
            </p>
            <div className="space-y-3">
              <Checkbox
                className="w-full rounded-xl border border-line p-4 hover:bg-soft/40"
                label="Ontologia"
                description="Mapeie áreas, pessoas, processos, sistemas e suas relações."
                checked={config.modules.ontology}
                onCheckedChange={(checked) =>
                  setConfig({ ...config, modules: { ...config.modules, ontology: checked } })
                }
              />
            </div>
            <p className="mt-4 text-[12px] leading-relaxed text-muted">
              Desativar um recurso oculta sua navegação e preserva os registros
              para quando precisar retomá-lo.
            </p>
            <div className="mt-5 rounded-xl border border-line p-4">
              <p className="text-[14px] font-medium">Grupo de WhatsApp</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                As conversas do grupo do cliente ficam na base do Supabase e
                aparecem em Interações › Conversas, só para leitura. Informe o
                nome do grupo exatamente como ele está no WhatsApp, que é como a
                base o registra.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <FieldBlock label="Nome exato do grupo">
                  <input
                    className={fieldClass}
                    value={config.whatsapp?.groupName ?? ""}
                    placeholder="G4 × Hospital Santa Clara"
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        whatsapp:
                          e.target.value || config.whatsapp?.groupId
                            ? {
                                groupName: e.target.value,
                                groupId: config.whatsapp?.groupId,
                              }
                            : undefined,
                      })
                    }
                  />
                </FieldBlock>
                <FieldBlock label="Identificador (opcional)">
                  <input
                    className={fieldClass}
                    value={config.whatsapp?.groupId ?? ""}
                    placeholder="Só se a base usa id, ex.: 120363…@g.us"
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        whatsapp: {
                          groupName: config.whatsapp?.groupName ?? "",
                          groupId: e.target.value.trim() || undefined,
                        },
                      })
                    }
                  />
                </FieldBlock>
              </div>
            </div>
          </>
        )}
        {storageError && (
          <p role="alert" className="mt-4 text-[13px] text-rose">
            {storageError}
          </p>
        )}
        </fieldset>
      </form>
    </Drawer>
  );
}
