"use client";
import { clientEntry } from "@/shared/infrastructure/client-entry";
import { useCatalogOperations, CatalogOperationFeedback } from "../useCatalogOperations";
import { deadlineSummary } from "../../domain/task-deadlines";
import { ProductVersions } from "../ProductVersions";
import { BaseDeliveryDrawer } from "../BaseDeliveryDrawer";
import { Combobox } from "@/shared/ui/Combobox";
import type {
  CycleTemplate,
  Product,
} from "@/modules/catalog/domain/products";
import { InlineCycleEditor } from "@/modules/catalog/presentation/InlineCycleEditor";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useCatalogState } from "@/modules/catalog/infrastructure/state";
import { serviceModelLabel } from "@/modules/clients/domain/service-config";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { paths } from "@/shared/lib/routes";
import { cn } from "@/shared/lib/cn";
import { fieldClass } from "@/shared/ui/Drawer";
import { PageHeading } from "@/shared/ui/PageHeading";
import { Button, Empty, Page } from "@/shared/ui/primitives";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Package,
  Pencil,
  Plus,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  ProductForm,
  TemplateForm,
} from "./produtos/ProductForms";

function ProductsPageContent() {
  const { can } = usePermissions();
  const operation = useCatalogOperations();
  const { products, saveProduct, storageError: catalogError } = useCatalogState();
  const { clients: allClients, configFor, storageError: clientError } = useClientsState();
  const storageError = catalogError ?? clientError;
  const initialProduct = useSearchParams().get("produto");
  const [selected, setSelected] = useState(
    initialProduct ?? products[0]?.id ?? "",
  );
  const [selectedCycle, setSelectedCycle] = useState("");
  const product = products.find((p) => p.id === selected) ?? products[0];
  const cycle =
    product?.cycles.find((c) => c.id === selectedCycle) ?? product?.cycles[0];
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [creatingCycle, setCreatingCycle] = useState<CycleTemplate | null>(
    null,
  );
  const [editingDelivery, setEditingDelivery] = useState<{
    productId: string;
    cycleId: string;
    deliveryId: string;
  } | null>(null);
  const deliveryProduct = products.find(
    (p) => p.id === editingDelivery?.productId,
  );
  const deliveryCycle = deliveryProduct?.cycles.find(
    (c) => c.id === editingDelivery?.cycleId,
  );
  const delivery = deliveryCycle?.deliveries.find(
    (d) => d.id === editingDelivery?.deliveryId,
  );
  const [draft, setDraft] = useState<CycleTemplate | null>(null);
  const clients = allClients.filter((c) =>
    configFor(c.slug).productIds?.includes(product?.id),
  );
  const totalDeliveries =
    product?.cycles.reduce((n, c) => n + c.deliveries.length, 0) ?? 0;
  function newCycle() {
    setCreatingCycle({
      id: `template-${crypto.randomUUID()}`,
      name: "",
      goal: "",
      durationDays: 14,
      deliveries: [],
      acceptance: ["Tarefas aprovadas pelo cliente"],
    });
  }
  function saveConfirmed(product:Product,confirmed:()=>void){
    return operation.run("products.save",{product},()=>saveProduct(product),confirmed,"Produto salvo");
  }
  function saveTemplate(next: CycleTemplate) {
    if (!product) return;
    return saveConfirmed({...product,cycles:product.cycles.some(c=>c.id===next.id)?product.cycles.map(c=>c.id===next.id?next:c):[...product.cycles,next]},()=>{
      setSelectedCycle(next.id);setDraft(null);setCreatingCycle(null);
    });
  }
  return (
    <Page className="max-w-none">
      {delivery &&
        deliveryCycle &&
        deliveryProduct &&
        can("catalogo.editar") && (
          <BaseDeliveryDrawer
            key={delivery.id}
            delivery={delivery}
            cycle={deliveryCycle}
            productName={deliveryProduct.name}
            operation={operation}
            onClose={() => {if(!operation.busy)setEditingDelivery(null);}}
            onSave={(next) => {
              void saveConfirmed({
                ...deliveryProduct,
                cycles: deliveryProduct.cycles.map((c) =>
                  c.id === deliveryCycle.id
                    ? {
                        ...c,
                        deliveries: c.deliveries.map((d) =>
                          d.id === next.id ? next : d,
                        ),
                      }
                    : c,
                ),
              },()=>setEditingDelivery(null));
            }}
          />
        )}
      <PageHeading
        title="Produtos"
        description="Organize o produto em ciclos com prazos, marcos, tarefas e checklists."
        actions={
          <>
            {can("catalogo.editar") && (
              <Button
                disabled={!!draft}
                onClick={() =>
                  setEditingProduct({
                    id: `product-${crypto.randomUUID()}`,
                    name: "",
                    description: "",
                    serviceModel: "consultoria",
                    cycles: [],
                  })
                }
              >
                <Plus className="h-4 w-4" />
                Novo produto
              </Button>
            )}
          </>
        }
      />
      {!editingProduct && !creatingCycle && !editingDelivery && !draft && <CatalogOperationFeedback operation={operation} />}
      {storageError && (
        <p role="alert" className="mt-4 text-[13px] text-rose">
          {storageError}
        </p>
      )}
      <div className="mt-5 md:hidden">
        <label htmlFor="product-selection" className="sr-only">
          Produto
        </label>
        <Combobox
          label="Produto"
          id="product-selection"
          disabled={!!draft}
          className={fieldClass}
          value={String(product?.id ?? "")}
          onValueChange={(value) => {
            setSelected(value);
            setSelectedCycle("");
          }}
          options={products.map((p) => ({ value: p.id, label: p.name }))}
        />
      </div>
      <nav
        aria-label="Produtos"
        className="mt-5 hidden gap-6 overflow-x-auto border-b border-line md:flex"
      >
        {products.map((p) => (
          <button
            key={p.id}
            disabled={!!draft}
            aria-pressed={p.id === product?.id}
            onClick={() => {
              setSelected(p.id);
              setSelectedCycle("");
            }}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 py-3 text-[13px] transition-colors disabled:cursor-default",
              p.id === product?.id
                ? "border-ink font-medium text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            <Package className="h-3.5 w-3.5" />
            {p.name}
          </button>
        ))}
      </nav>
      {product && (
        <div className="py-6">
          <ProductVersions key={product.id} product={product} />
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-record font-semibold tracking-tight">
                {product.name}
              </h2>
              <p className="mt-1.5 max-w-3xl text-[13px] leading-6 text-muted">
                {product.description}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
                <span>{product.cycles.length} ciclos</span>
                <span>{totalDeliveries} tarefas base</span>
                {product.serviceModel && (
                  <span>{serviceModelLabel[product.serviceModel]}</span>
                )}
                <span>
                  {clients.length}{" "}
                  {clients.length === 1 ? "cliente" : "clientes"}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={!!draft}
              onClick={() => setEditingProduct(structuredClone(product))}
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar produto
            </Button>
          </div>
          <section className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="border-b border-line bg-soft/35 px-4 py-4 sm:px-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-[12px] font-medium text-ink-soft">
                  Ciclos do produto
                </h3>
                <button
                  disabled={!!draft}
                  onClick={newCycle}
                  className="inline-flex items-center gap-1.5 text-[12px] text-ink-soft hover:text-ink disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar ciclo
                </button>
              </div>
              {cycle && (
                <div className="sm:hidden">
                  <label htmlFor="cycle-selection" className="sr-only">
                    Ciclo do produto
                  </label>
                  <Combobox
                    label="Modelo de ciclo"
                    id="cycle-selection"
                    disabled={!!draft}
                    className={fieldClass}
                    value={cycle.id}
                    onValueChange={(value) => setSelectedCycle(value)}
                    options={product.cycles.map((t, i) => ({
                      value: t.id,
                      label: [
                        String(i + 1).padStart(2, "0"),
                        " · ",
                        t.name,
                      ].join(""),
                    }))}
                  />
                </div>
              )}
              <ol
                aria-label="Sequência de ciclos"
                className="hidden gap-3 overflow-x-auto pb-1 sm:flex"
              >
                {product.cycles.map((t, i) => (
                  <li key={t.id} className="min-w-[190px] flex-1">
                    <button
                      disabled={!!draft}
                      aria-pressed={cycle?.id === t.id}
                      onClick={() => setSelectedCycle(t.id)}
                      className="group w-full rounded-lg text-left disabled:cursor-default"
                    >
                      <div className="mb-2.5 flex items-center gap-3">
                        <span
                          className={cn(
                            "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition-colors",
                            cycle?.id === t.id
                              ? "bg-ink text-on-ink"
                              : "border border-line-strong bg-surface text-muted group-hover:border-ink",
                          )}
                        >
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span aria-hidden className="h-px flex-1 bg-line" />
                        {i < product.cycles.length - 1 && (
                          <ChevronRight
                            aria-hidden
                            className="-ml-3 h-3 w-3 text-line-strong"
                          />
                        )}
                      </div>
                      <span
                        className={cn(
                          "block text-[13px] leading-5",
                          cycle?.id === t.id
                            ? "font-semibold text-ink"
                            : "text-muted group-hover:text-ink",
                        )}
                      >
                        {t.name}
                      </span>
                      <span className="mt-1 block text-[11px] text-muted">
                        {t.durationDays} dias · {t.deliveries.length} tarefas
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {!product.cycles.length && (
                <p className="text-[13px] text-muted">
                  Defina o primeiro ciclo para começar.
                </p>
              )}
            </div>
            {cycle ? (
              draft ? (
                <InlineCycleEditor
                  operation={operation}
                  draft={draft}
                  onChange={setDraft}
                  onCancel={() => {if(!operation.busy)setDraft(null);}}
                  onSave={saveTemplate}
                />
              ) : (
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4 sm:px-6">
                    <div className="min-w-0">
                      <h3 className="text-section font-semibold tracking-tight">
                        {cycle.name}
                      </h3>
                      <p className="mt-1.5 max-w-2xl text-[13px] leading-6 text-muted">
                        {cycle.goal}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDraft(structuredClone(cycle))}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar ciclo
                    </Button>
                  </div>
                  <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="min-w-0 border-t border-line px-4 pb-5 sm:px-6">
                      <div className="flex items-center justify-between py-4">
                        <h4 className="text-[13px] font-medium">
                          Tarefas base{" "}
                          <span className="ml-1 text-muted">
                            {cycle.deliveries.length}
                          </span>
                        </h4>
                        <span className="text-[11px] text-muted">
                          Prazos a partir do início
                        </span>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_65px_55px] gap-x-3 border-b border-line pb-2 text-[10px] font-medium uppercase tracking-wider text-muted sm:grid-cols-[minmax(0,1fr)_95px_70px]">
                        <span>Tarefa</span>
                        <span className="text-right">Prazo</span>
                        <span className="text-right">Esforço</span>
                      </div>
                      <ul className="divide-y divide-line">
                        {cycle.deliveries.map((d) => (
                          <li
                            key={d.id}
                            className="grid grid-cols-[minmax(0,1fr)_65px_55px] items-start gap-x-3 py-4 sm:grid-cols-[minmax(0,1fr)_95px_70px]"
                          >
                            <div className="flex min-w-0 gap-2.5">
                              <FileText className="mt-0.5 hidden h-4 w-4 shrink-0 text-muted sm:block" />
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  disabled={!can("catalogo.editar")}
                                  onClick={() =>
                                    setEditingDelivery({
                                      productId: product.id,
                                      cycleId: cycle.id,
                                      deliveryId: d.id,
                                    })
                                  }
                                  className="text-left text-[13px] font-medium leading-5 hover:underline disabled:cursor-default disabled:no-underline"
                                >
                                  {d.title}
                                  {can("catalogo.editar") && (
                                    <Pencil className="ml-2 inline h-3 w-3 text-muted" />
                                  )}
                                </button>
                                <p className="mt-1 text-[11px] text-muted">
                                  {d.checklistItems?.length
                                    ? `${d.checklistItems.length} itens no checklist`
                                    : "Sem checklist"}
                                </p>
                                {d.description && (
                                  <p className="mt-1 text-[12px] leading-5 text-muted">
                                    {d.description}
                                  </p>
                                )}
                              </div>
                            </div>
                            <span title={deadlineSummary(d.deadline, cycle.deliveries, d.day)} className="line-clamp-2 text-right text-[12px] leading-5 text-ink-soft">
                              {deadlineSummary(d.deadline, cycle.deliveries, d.day)}
                            </span>
                            <span className="text-right text-[12px] leading-5 text-muted">
                              {d.hours}h
                            </span>
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() =>
                          setDraft({
                            ...structuredClone(cycle),
                            deliveries: [
                              ...structuredClone(cycle.deliveries),
                              {
                                id: crypto.randomUUID(),
                                title: "",
                                description: "",
                                day: cycle.durationDays,
                                hours: 0,
                              },
                            ],
                          })
                        }
                        className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Adicionar tarefa
                      </button>
                    </div>
                    <aside className="border-t border-line bg-soft/20 px-4 py-4 sm:px-6 lg:border-l">
                      <div className="mb-5 flex items-start gap-6 border-b border-line pb-4">
                        <div>
                          <p className="text-[11px] text-muted">
                            Duração padrão
                          </p>
                          <p className="mt-1 text-[18px] font-semibold">
                            {cycle.durationDays}{" "}
                            <span className="text-[12px] font-normal text-muted">
                              dias
                            </span>
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-muted">
                            Esforço previsto
                          </p>
                          <p className="mt-1 text-[18px] font-semibold">
                            {cycle.deliveries.reduce((n, d) => n + d.hours, 0)}
                            <span className="text-[12px] font-normal text-muted">
                              {" "}
                              h
                            </span>
                          </p>
                        </div>
                      </div>
                      <h4 className="mb-3 text-[13px] font-medium">
                        Critérios de aceite
                      </h4>
                      <ul className="space-y-3">
                        {cycle.acceptance.map((a, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-[12px] leading-5 text-ink-soft"
                          >
                            <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-muted" />
                            <span>{a}</span>
                          </li>
                        ))}
                      </ul>
                    </aside>
                  </div>
                  <div className="flex items-start gap-2 border-t border-line px-4 py-3 text-[11px] leading-5 text-muted sm:px-6">
                    <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Cada cliente recebe uma cópia deste ciclo, com tarefas e
                    prazos ajustáveis.
                  </div>
                </div>
              )
            ) : (
              <div className="px-6 py-8">
                <Empty
                  title="Comece pelo primeiro ciclo"
                  hint="Defina o resultado esperado e as tarefas que fazem parte dele."
                  action={
                    <Button size="sm" onClick={newCycle}>
                      <Plus className="h-3.5 w-3.5" />
                      Criar primeiro ciclo
                    </Button>
                  }
                />
              </div>
            )}
          </section>
          <section className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 text-[12px]">
            <h3 className="flex items-center gap-2 text-muted">
              <UsersRound className="h-3.5 w-3.5" />
              Clientes com este produto
            </h3>
            {clients.map((c) => (
              <Link
                key={c.slug}
                href={clientEntry(c.slug)}
                className="inline-flex items-center gap-2 rounded-lg py-1 hover:underline"
              >
                <span
                  className="grid h-6 w-6 place-items-center rounded-md text-[10px] font-medium"
                  style={{ background: `${c.tint}12`, color: c.tint }}
                >
                  {c.name[0]}
                </span>
                {c.name}
                <ArrowUpRight className="h-3 w-3 text-muted" />
              </Link>
            ))}
            {!clients.length && (
              <Link
                href={paths.clients}
                className="text-ink-soft hover:underline"
              >
                Vincular nas configurações do cliente →
              </Link>
            )}
          </section>
        </div>
      )}
      {editingProduct && (
        <ProductForm
          operation={operation}
          product={editingProduct}
          onClose={() => {if(!operation.busy)setEditingProduct(null);}}
          onSave={(p) => {
            void saveConfirmed(p,()=>{setSelected(p.id);setSelectedCycle("");setEditingProduct(null);});
          }}
        />
      )}
      {creatingCycle && (
        <TemplateForm
          operation={operation}
          template={creatingCycle}
          onClose={() => {if(!operation.busy)setCreatingCycle(null);}}
          onSave={saveTemplate}
        />
      )}
    </Page>
  );
}

/** Suspense dentro do módulo cliente, não em `page.tsx`: ver `docs/navegacao-e-visualizacoes.md`. */
export default function ProductsPage() {
  return (
    <Suspense>
      <ProductsPageContent />
    </Suspense>
  );
}
