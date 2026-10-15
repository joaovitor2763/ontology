"use client";
import { clientEntry } from "@/shared/infrastructure/client-entry";
import { DatePicker } from "@/shared/ui/DatePicker";
import { Select } from "@/shared/ui/Select";
import {
  clientError,
  clientTints,
  slugify,
  type Charter,
  type Company,
} from "@/modules/clients/domain/models";
import {
  CharterFields,
  emptyCharter,
} from "@/modules/clients/presentation/CharterFields";
import {
  defaultService,
  serviceModelLabel,
  type ServiceConfig,
} from "@/modules/clients/domain/service-config";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useProductPreparation } from "@/modules/delivery/presentation/ProductPreparation";
import { prepareProduct } from "@/modules/delivery/application/product-execution";
import { suggestLead } from "@/modules/catalog/domain/products";
import { useCatalogState } from "@/modules/catalog/infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { NOW } from "@/shared/lib/format";
import { Combobox } from "@/shared/ui/Combobox";
import { Drawer, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { CheckboxGroup } from "@g4ai/ds";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { executeClientOperation, operationAttempt, usesRemoteOperations, type OperationAttempt } from "@/shared/infrastructure/operations";
import { notify } from "@/shared/ui/Feedback";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";

const hasCharter = (c: Charter) =>
  Boolean(
    c.objective.trim() ||
    c.clarifiedObjective?.trim() ||
    c.finishedLooksLike.trim() ||
    c.keyQuestion.trim() ||
    Object.values(c.constraints ?? {}).some((v) => v?.trim()),
  );

/** Creates a client with its service scope, purchased products and responsible in one step. */
export function ClientForm({ onClose }: { onClose: () => void }) {
  const { mode, resolved } = useSyncStatus();
  if (!resolved) return <div role="status" className="p-6 text-sm text-muted">Carregando cadastro…</div>;
  return mode === "remote" ? <ClientFormEditor onClose={onClose} /> : <LocalClientForm onClose={onClose} />;
}

function LocalClientForm({ onClose }: { onClose: () => void }) {
  const savePrepared = useProductPreparation();
  return <ClientFormEditor onClose={onClose} savePrepared={savePrepared} />;
}

function ClientFormEditor({ onClose, savePrepared }: {
  onClose: () => void;
  savePrepared?: ReturnType<typeof useProductPreparation>;
}) {
  const router = useRouter();
  const { allClients, createClient, setAssignment, allocationsFor, assigned, saveEnrollment } =
    useClientsState();
  const { products } = useCatalogState();
  const { active, me } = useTeam();
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [sector, setSector] = useState("");
  const [city, setCity] = useState("");
  const [uf, setUf] = useState("");
  const [scope, setScope] = useState("");
  const [model, setModel] = useState<ServiceConfig["model"]>("consultoria");
  const [productIds, setProductIds] = useState<string[]>([]);
  const selectedProductModels = [
    ...new Set(
      products
        .filter((product) => productIds.includes(product.id))
        .flatMap((product) => product.serviceModel ?? []),
    ),
  ];
  const productModel =
    selectedProductModels.length === 1 ? selectedProductModels[0] : undefined;
  const effectiveModel = productModel ?? model;
  const [leadId, setLeadIdState] = useState(me.id);
  const [leadTouched, setLeadTouched] = useState(false);
  const setLeadId = (id: string) => {
    setLeadTouched(true);
    setLeadIdState(id);
  };
  const clientCount = (memberId: string) =>
    allClients.filter(
      (c) =>
        allocationsFor(c.slug).some((a) => a.memberId === memberId) ||
        assigned(c).leadId === memberId,
    ).length;
  const autoProduct = products.find(
    (p) => productIds.includes(p.id) && p.autoAllocateLead,
  );
  const suggested = autoProduct ? suggestLead(active, clientCount) : undefined;
  const effectiveLead = !leadTouched && suggested ? suggested.id : leadId;
  const [contract, setContract] = useState("");
  const [startedAt, setStartedAt] = useState(NOW.slice(0, 10));
  const [charter, setCharter] = useState<Charter>(emptyCharter);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const attempt = useRef<OperationAttempt | null>(null);
  const slug = slugify(name);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const problem = clientError({ slug, name }, attempt.current?.expectedVersions
      ? allClients.filter((client) => client.slug !== slug)
      : allClients);
    if (problem) {
      setError(problem);
      return;
    }
    const client: Company = {
      slug,
      name: name.trim(),
      legalName: legalName.trim() || name.trim(),
      sector: sector.trim(),
      city: city.trim(),
      uf: uf.trim().toUpperCase(),
      status: "ativo",
      milestone: 1,
      health: 80,
      healthFlag: "green",
      coverage: 0,
      sponsorId: "",
      leadId: effectiveLead,
      csId: effectiveLead,
      startedAt,
      contract: contract.trim(),
      nextMilestone: "",
      nextMilestoneAt: "",
      summary: scope.trim(),
      tint: clientTints[allClients.length % clientTints.length],
      journeyId: "",
      charter: hasCharter(charter) ? charter : undefined,
      createdBy: me.id,
    };
    let drafts: { draft: ReturnType<typeof prepareProduct>; enrollmentId: string; createdAt: string }[];
    try {
      const createdAt = new Date().toISOString();
      drafts = products
        .filter((p) => productIds.includes(p.id))
        .map((p) => {
          const enrollmentId=crypto.randomUUID();
          return { enrollmentId, createdAt, draft: prepareProduct(p, client, createdAt, { id: enrollmentId, startsAt: startedAt }) };
        });
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const config: ServiceConfig = {
      ...defaultService,
      name: scope.trim() || name.trim(),
      model: effectiveModel,
      productIds: [...new Set(productIds)],
      modules: { ontology: false },
    };
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      if (await usesRemoteOperations()) {
        const input = { client, config, leadId: effectiveLead, csId: effectiveLead, productIds: config.productIds };
        attempt.current = operationAttempt("clients.create", input, attempt.current);
        await executeClientOperation("clients.create", input, attempt.current);
        notify(`Cliente ${client.name} criado`);
      } else {
        if (!savePrepared) throw new Error("A preparação local do produto não está disponível.");
        createClient(client, config);
        setAssignment(slug, effectiveLead, effectiveLead);
        for(const {draft,enrollmentId,createdAt} of drafts) {
          savePrepared(draft);
          saveEnrollment({id:enrollmentId,company:slug,productId:draft.plan.productId!,productVersion:products.find(product=>product.id===draft.plan.productId)?.version??1,startsAt:startedAt,status:"ativa",planId:draft.plan.id,createdAt,createdBy:me.id,createdProductLink:true,lifecycleHistory:[{type:"created",at:createdAt,by:me.id}]});
        }
      }
      onClose();
      router.push(clientEntry(slug));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível criar o cliente. Tente novamente.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={() => { if (!submitting.current) onClose(); }}
      title="Novo cliente"
      kicker="Cadastro, escopo e equipe em um passo."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="client-form" disabled={!name.trim() || saving}>
            {saving ? "Salvando…" : "Criar cliente"}
          </Button>
        </div>
      }
    >
      <form id="client-form" onSubmit={submit}>
        <fieldset disabled={saving} className="min-w-0">
        <FieldBlock label="Nome">
          <input
            required
            autoFocus
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome pelo qual a equipe chama o cliente"
          />
        </FieldBlock>
        {slug && (
          <p className="-mt-3 mb-5 text-[12px] text-muted">
            Endereço: /clientes/{slug}
          </p>
        )}
        <FieldBlock label="Razão social">
          <input
            className={fieldClass}
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
          />
        </FieldBlock>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_72px]">
          <FieldBlock label="Setor">
            <input
              className={fieldClass}
              value={sector}
              onChange={(e) => setSector(e.target.value)}
            />
          </FieldBlock>
          <FieldBlock label="Cidade">
            <input
              className={fieldClass}
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </FieldBlock>
          <FieldBlock label="UF">
            <input
              className={fieldClass}
              maxLength={2}
              value={uf}
              onChange={(e) => setUf(e.target.value)}
            />
          </FieldBlock>
        </div>
        <div className="my-6 border-t border-line pt-6">
          <h3 className="text-[14px] font-medium">Serviço</h3>
        </div>
        <FieldBlock label="Escopo">
          <input
            className={fieldClass}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="O que será entregue para este cliente"
          />
        </FieldBlock>
        <FieldBlock label="Modelo de trabalho">
          <Select
            label="Modelo de trabalho"
            value={effectiveModel}
            onValueChange={(v) => setModel(v as ServiceConfig["model"])}
            disabled={Boolean(productModel)}
            options={Object.entries(serviceModelLabel).map(([id, label]) => ({
              value: id,
              label,
            }))}
          />
          {productModel && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              Definido pelo produto contratado.
            </p>
          )}
        </FieldBlock>
        <CheckboxGroup
          label="Produtos contratados"
          className="mb-5"
          options={products.map((p) => ({ value: p.id, label: p.name }))}
          value={productIds}
          onValueChange={setProductIds}
        />
        <div className="my-6 border-t border-line pt-6">
          <h3 className="text-[14px] font-medium">Contrato de valor</h3>
          <p className="mt-1 text-[12px] text-muted">
            O que o cliente pediu, o que a equipe entendeu e como fica quando
            termina. Pode ser preenchido depois, em Configurar cliente.
          </p>
        </div>
        <CharterFields value={charter} onChange={setCharter} />
        <div className="my-6 border-t border-line pt-6">
          <h3 className="text-[14px] font-medium">Equipe e contrato</h3>
        </div>
        <FieldBlock label="Responsável">
          <Combobox
            label="Responsável"
            className={fieldClass}
            value={effectiveLead}
            onValueChange={setLeadId}
            options={active.map((p) => ({
              value: p.id,
              label: p.name,
              description: p.role,
            }))}
          />
          {suggested && !leadTouched && (
            <p className="mt-1.5 text-[12px] text-muted">
              Alocação automática de {autoProduct?.name}: {suggested.name} é o
              AI Master com menos clientes ({clientCount(suggested.id)}). Troque
              se quiser.
            </p>
          )}
        </FieldBlock>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBlock label="Contrato">
            <input
              className={fieldClass}
              value={contract}
              onChange={(e) => setContract(e.target.value)}
              placeholder="Consultoria · 12 semanas"
            />
          </FieldBlock>
          <FieldBlock label="Início">
            <DatePicker label="Início" className={fieldClass} value={startedAt} onValueChange={(next) => setStartedAt(next)} />
          </FieldBlock>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-rose">
            {error}
          </p>
        )}
        </fieldset>
      </form>
    </Drawer>
  );
}
