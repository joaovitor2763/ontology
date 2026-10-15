"use client";
import { useFilesPanel } from "./files/useFilesPanel";
import { useDocumentTaskTitles } from "./files/useDocumentTaskTitles";
import { deliveryById } from "@/modules/delivery/infrastructure/queries";
import { useClientProgress } from "@/modules/delivery/presentation/useClientProgress";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { DocumentPreview } from "./DocumentPreview";
import {
  kindOptions,
  StageDocumentModal,
  visibilityOptions,
} from "@/modules/documents/presentation/StageDocumentModal";
import { deliverableTemplateById } from "@/modules/documents/infrastructure/deliverable-templates";
import {
  docReviewLabel,
  documentVersion,
  type DocKind,
  type DocVisibility,
} from "@/modules/documents/domain/models";
import { paths } from "@/shared/lib/routes";
import { Modal } from "@/shared/ui/Dialog";
import { ActionMenu } from "@/shared/ui/Menu";
import { Select } from "@/shared/ui/Select";
import {
  CheckCircle2,
  Download,
  FileText,
  Image as ImageIcon,
  MessageSquareWarning,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/shared/lib/cn";
import {
  docKindLabel,
  formatBytes,
  formatDate,
  formatDateTime,
} from "@/shared/lib/format";
import { DisplayControls } from "@/shared/ui/DisplayControls";
import { areaClass, Drawer, FieldBlock } from "@/shared/ui/Drawer";
import { FacetFilter } from "@/shared/ui/FacetFilter";
import { TableToolbar } from "@/shared/ui/TableToolbar";
import { Checkbox } from "@/shared/ui/Checkbox";
import { DataTable } from "@g4ai/ds";
import { Badge, Button, Empty } from "@/shared/ui/primitives";
import { DocumentOperationFeedback } from "./useDocumentOperation";
import { OperationButton } from "@/shared/ui/OperationFeedback";
import { DOCUMENT_ACCEPT as ACCEPT } from "@/modules/documents/presentation/StageDocumentModal";

export function FilesPanel({ company }: { company?: string }) {
  const { mode, resolved } = useSyncStatus();
  if (!resolved) return null;
  return mode === "remote" && !company
    ? <RemoteFilesPanel />
    : <ClientOrLocalFilesPanel company={company} />;
}

function RemoteFilesPanel() {
  const { values, error } = useDocumentTaskTitles();
  return <FilesPanelContent deliveryTitle={id => values[id] ?? deliveryById(id)?.title}
    titleError={error} />;
}

function ClientOrLocalFilesPanel({ company }: { company?: string }) {
  const progress = useClientProgress(company ?? "");
  return <FilesPanelContent company={company}
    deliveryTitle={id => progress.all.find(task => task.id === id)?.title ?? deliveryById(id)?.title} />;
}

function FilesPanelContent({ company, deliveryTitle, titleError = "" }: {
  company?: string;
  deliveryTitle: (id: string) => string | undefined;
  titleError?: string;
}) {
  const {
    view,
    setView,
    density,
    setDensity,
    updateDocument,
    restoreDoc,
    clientBySlug,
    resolve,
    all,
    q,
    setQ,
    kinds,
    setKinds,
    showOld,
    setShowOld,
    fileError,
    setFileError,
    pending,
    over,
    setOver,
    setOpen,
    removing,
    setRemoving,
    staged,
    setStaged,
    setEdit,
    requestingChanges,
    setRequestingChanges,
    changeNote,
    setChangeNote,
    reviewError,
    isAdmin,
    operation,
    removed,
    setRemoved,
    input,
    versionInput,
    versionFor,
    setVersionFor,
    meetingTitle,
    rows,
    stage,
    download,
    selected,
    form,
    dirty,
    chain,
    rowActions,
    reviewable,
    review,
    removeSelected,
    reviewTone,
    setPending,
  } = useFilesPanel(company, deliveryTitle);
  return (
    <div data-density={density}>
      {!selected && !removing && !requestingChanges && <DocumentOperationFeedback operation={operation} />}
      {removed && <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-line p-3 text-sm"><span>{removed.name} foi removido. O arquivo está preservado.</span><OperationButton operation={operation} busyLabel="Restaurando…" size="sm" onClick={()=>void operation.run("documents.restore",{documentId:removed.id},()=>restoreDoc(removed.id),()=>setRemoved(null))}>Restaurar documento</OperationButton></div>}
      {fileError && (
        <p
          role="alert"
          className="mb-3 rounded-lg bg-rose-soft p-3 text-[13px] text-rose"
        >
          {fileError}
        </p>
      )}
      {titleError && <p role="alert" className="mb-3 text-[13px] text-rose">{titleError}</p>}
      {pending > 0 && (
        <p role="status" className="mb-3 text-[13px] text-muted">
          Salvando {pending} documento(s)…
        </p>
      )}
      <button
        type="button"
        disabled={!company}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          stage(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "group flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-line px-4 py-3 text-center transition-colors sm:flex-row sm:gap-4 sm:text-left",
          over ? "bg-soft border-line-strong" : "hover:bg-soft/60",
        )}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-soft/60">
          <Upload className="h-4 w-4 text-muted" />
        </span>
        <div>
          <div className="mt-2 text-[13px] font-medium sm:mt-0">
            {company
              ? "Solte documentos aqui ou clique para anexar"
              : "Selecione um cliente para anexar documentos"}
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            PDF, Word, planilha, imagem. Você escolhe o tipo e o vínculo antes
            de salvar.
          </div>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          accept={ACCEPT}
          onChange={(e) => {
            stage(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </button>
      <input
        ref={versionInput}
        type="file"
        className="hidden"
        accept={ACCEPT}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && versionFor) {
            setOpen(null);
            stage([file], versionFor);
          }
          setVersionFor(null);
          e.target.value = "";
        }}
      />

      <div className="mt-5 mb-3">
        <TableToolbar
          query={q}
          onQuery={setQ}
          placeholder="Filtrar documentos…"
          shown={rows.length}
          total={all.length}
          noun="documento"
          dirty={Boolean(q.trim() || kinds.length)}
          onClear={() => {
            setQ("");
            setKinds([]);
          }}
        >
          <FacetFilter
            label="Tipo"
            options={kindOptions.map((k) => ({ id: k.value, label: k.label }))}
            value={kinds}
            onChange={setKinds}
          />
          <Checkbox
            label="Versões anteriores"
            hideLabel={false}
            checked={showOld}
            onCheckedChange={setShowOld}
          />
          <DisplayControls
            view={view}
            onView={setView}
            density={density}
            onDensity={setDensity}
          />
        </TableToolbar>
      </div>

      <DataTable
        label="Documentos"
        view={view === "cards" ? "cards" : "list"}
        density={density}
        rows={rows}
        rowKey={(d) => d.id}
        rowLabel={(d) => `Abrir documento: ${d.name}`}
        onRowClick={(d) => {
          operation.begin();
          setOpen(d);
        }}
        empty={
          <Empty
            title="Nenhum documento"
            hint="Anexe o contrato, as atas e as evidências deste cliente."
          />
        }
        columns={[
          {
            key: "name",
            header: "Documento",
            primary: true,
            cell: (d) => {
              const version = documentVersion(d);
              const replaced = all.some((x) => x.supersedesId === d.id);
              return (
                <div className={cn("flex items-center gap-2", replaced && "text-muted")}>
                  {d.mime.startsWith("image/") ? (
                    <ImageIcon className="h-4 w-4 shrink-0 text-muted" />
                  ) : (
                    <FileText className="h-4 w-4 shrink-0 text-muted" />
                  )}
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{d.name}</span>
                      {version > 1 && (
                        <Badge tone={replaced ? "neutral" : "ok"}>
                          v{version}
                          {replaced ? "" : " · vigente"}
                        </Badge>
                      )}
                      {replaced && version === 1 && (
                        <Badge tone="neutral">v1 · substituída</Badge>
                      )}
                      {d.reviewStatus && !replaced && (
                        <Badge tone={reviewTone(d.reviewStatus)}>
                          {docReviewLabel[d.reviewStatus]}
                        </Badge>
                      )}
                    </span>
                    {!company && (
                      <span className="mt-1 block text-meta font-normal text-muted">
                        {clientBySlug(d.company)?.name}
                      </span>
                    )}
                  </span>
                </div>
              );
            },
          },
          {
            key: "kind",
            header: "Tipo",
            className: "text-ink-soft",
            cell: (d) => docKindLabel[d.kind],
          },
          {
            key: "related",
            header: "Vinculado a",
            wide: true,
            className: "max-w-[220px] truncate text-ink-soft",
            cell: (d) =>
              (d.relatedTaskId && deliveryTitle(d.relatedTaskId)) ??
              (d.relatedMeetingId && meetingTitle(d.relatedMeetingId)) ??
              "—",
          },
          {
            key: "visibility",
            header: "Visibilidade",
            nowrap: true,
            className: "whitespace-nowrap text-label text-ink-soft",
            cell: (d) => (d.visibility === "cliente" ? "Cliente" : "Interna"),
          },
          {
            key: "size",
            header: "Tamanho",
            nowrap: true,
            className: "whitespace-nowrap tabular-nums text-ink-soft",
            cell: (d) => formatBytes(d.size),
          },
          {
            key: "uploaded",
            header: "Enviado",
            nowrap: true,
            className: "whitespace-nowrap tabular-nums text-ink-soft",
            cell: (d) => formatDateTime(d.uploadedAt),
          },
          {
            key: "actions",
            header: <span className="sr-only">Ações</span>,
            action: true,
            align: "right",
            cell: (d) => (
              <span onKeyDown={(e) => e.stopPropagation()}>
                <ActionMenu label={`Ações de ${d.name}`} actions={rowActions(d)} />
              </span>
            ),
          },
        ]}
      />

      {company && (
        <StageDocumentModal
          company={company}
          staged={staged}
          onChange={setStaged}
          onClose={() => setStaged(null)}
          onError={setFileError}
          onPending={(delta) => setPending((n) => Math.max(0, n + delta))}
        />
      )}
      <Modal
        open={!!requestingChanges}
        onClose={() => {if(!operation.busy){operation.reset();setRequestingChanges(null);}}}
        title={requestingChanges ? `Solicitar ajustes em ${requestingChanges.name}` : ""}
        description="A nota fica registrada na trilha de revisão."
        footer={<OperationButton operation={operation} busyLabel="Solicitando…" onClick={()=>requestingChanges&&review(requestingChanges,"ajustes",changeNote)}>Solicitar ajustes</OperationButton>}
      >
        <textarea rows={3} disabled={operation.pending} className={areaClass} value={changeNote} onChange={e=>setChangeNote(e.target.value)} aria-label="Ajustes necessários" />
        <DocumentOperationFeedback operation={operation}/>
      </Modal>
      <Modal open={!!removing} onClose={()=>{if(!operation.busy){operation.reset();setRemoving(null);}}}
        title={removing ? `Remover ${removing.name}?` : ""}
        description="O documento sai da lista. O arquivo e o histórico são preservados para restauração."
        footer={<OperationButton operation={operation} busyLabel="Removendo…" variant="danger" onClick={removeSelected}>Remover documento</OperationButton>}
      ><DocumentOperationFeedback operation={operation}/></Modal>

      <Drawer
        open={!!selected}
        onClose={() => {if(!operation.busy){operation.reset();setOpen(null);}}}
        kicker={
          selected
            ? `${docKindLabel[selected.kind]} · v${documentVersion(selected)}`
            : undefined
        }
        title={selected?.name ?? ""}
        footer={
          selected && (
            <div className="flex items-center justify-between gap-3">
              <ActionMenu
                label="Mais ações"
                align="start"
                trigger={<span>Mais ações</span>}
                actions={rowActions(selected).filter(
                  (a) => a.label !== "Editar",
                )}
              />
              <div className="flex flex-wrap items-center gap-2">
                {dirty && form ? (
                  <Button
                    disabled={operation.busy}
                    onClick={() => {
                      const patch = {kind:form.kind,visibility:form.visibility,note:form.note.trim()};
                      void operation.run("documents.update",{documentId:selected.id,patch},()=>updateDocument(selected.id,patch),()=>setEdit(null));
                    }}
                  >
                    {operation.busy ? "Salvando…" : "Salvar alterações"}
                  </Button>
                ) : selected.id.startsWith("up-") ? (
                  <Button onClick={() => void download(selected)}>
                    <Download className="h-3.5 w-3.5" />
                    Baixar
                  </Button>
                ) : (
                  <span className="text-[12.5px] text-muted">
                    Documento de exemplo · conteúdo não anexado
                  </span>
                )}
              </div>
            </div>
          )
        }
      >
        <DocumentOperationFeedback operation={operation}/>
        {selected && form && (
          <fieldset disabled={operation.pending} className="space-y-5 text-[14px]">
            <DocumentPreview key={selected.id} document={selected} />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[12.5px] text-muted">Tamanho</div>
                <div className="mt-0.5">{formatBytes(selected.size)}</div>
              </div>
              <div>
                <div className="text-[12.5px] text-muted">Enviado</div>
                <div className="mt-0.5">
                  {formatDateTime(selected.uploadedAt)}
                  <span className="block text-[12px] text-muted">
                    {resolve(selected.uploadedBy).name}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <FieldBlock label="Tipo">
                <Select
                  label="Tipo"
                  value={form.kind}
                  onValueChange={(value) =>
                    setEdit({ ...form, kind: value as DocKind })
                  }
                  options={kindOptions}
                />
              </FieldBlock>
              <FieldBlock label="Visibilidade">
                <Select
                  label="Visibilidade"
                  value={form.visibility}
                  onValueChange={(value) =>
                    setEdit({ ...form, visibility: value as DocVisibility })
                  }
                  options={visibilityOptions}
                />
              </FieldBlock>
            </div>
            <FieldBlock label="Nota">
              <textarea
                rows={3}
                className={areaClass}
                value={form.note}
                onChange={(e) => setEdit({ ...form, note: e.target.value })}
                placeholder="Contexto ou pendências deste documento"
              />
            </FieldBlock>
            {selected.relatedTaskId && deliveryTitle(selected.relatedTaskId) && (
              <div>
                <div className="text-[12.5px] text-muted">Tarefa</div>
                <Link
                  href={paths.clientDeliveries(selected.company)}
                  className="mt-1 block font-medium hover:underline"
                >
                  {deliveryTitle(selected.relatedTaskId)}
                </Link>
              </div>
            )}
            {selected.relatedMeetingId &&
              meetingTitle(selected.relatedMeetingId) && (
                <div>
                  <div className="text-[12.5px] text-muted">Reunião</div>
                  <Link
                    href={paths.meeting(selected.relatedMeetingId)}
                    className="mt-1 block font-medium hover:underline"
                  >
                    {meetingTitle(selected.relatedMeetingId)}
                  </Link>
                </div>
              )}
            {(selected.reviewStatus || reviewable(selected)) && (
              <section
                aria-label="Revisão"
                className="rounded-xl border border-line p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[13px] font-medium">Revisão</h3>
                  <Badge tone={reviewTone(selected.reviewStatus)}>
                    {selected.reviewStatus
                      ? docReviewLabel[selected.reviewStatus]
                      : "Não revisado"}
                  </Badge>
                </div>
                {deliverableTemplateById(selected.deliverableTemplateId) && (
                  <div className="mt-3 text-[12.5px]">
                    <p className="text-muted">
                      Modelo ·{" "}
                      {deliverableTemplateById(selected.deliverableTemplateId)!.name}
                    </p>
                    <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-ink-soft">
                      {deliverableTemplateById(
                        selected.deliverableTemplateId,
                      )!.reviewChecklist.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {(selected.reviewHistory ?? []).length > 0 && (
                  <ol className="mt-3 space-y-2 border-t border-line pt-3 text-[12.5px]">
                    {[...(selected.reviewHistory ?? [])].reverse().map((r, i) => (
                      <li key={`${r.at}-${i}`}>
                        <span className="font-medium">{docReviewLabel[r.status]}</span>
                        <span className="text-muted">
                          {" "}· {resolve(r.by).name} · {formatDateTime(r.at)}
                        </span>
                        {r.notes && (
                          <p className="mt-0.5 text-ink-soft">{r.notes}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {isAdmin ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={operation.busy || selected.reviewStatus === "aprovado"}
                      onClick={() => review(selected, "aprovado")}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {operation.busy ? "Aprovando…" : "Aprovar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setChangeNote("");
                        setRequestingChanges(selected);
                      }}
                    >
                      <MessageSquareWarning className="h-3.5 w-3.5" />
                      Solicitar ajustes
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-[12px] text-muted">
                    A aprovação é feita por um administrador do workspace.
                  </p>
                )}
                {reviewError && !requestingChanges && (
                  <p role="alert" className="mt-2 text-[12.5px] text-rose">
                    {reviewError}
                  </p>
                )}
              </section>
            )}
            {chain.length > 1 && (
              <div>
                <div className="text-[12.5px] text-muted">Versões</div>
                <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                  {chain.map((v, i) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => setOpen(v)}
                        aria-current={v.id === selected.id ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-soft/60",
                          v.id === selected.id && "bg-soft/50",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Badge tone={i === 0 ? "ok" : "neutral"}>
                            v{documentVersion(v)}
                            {i === 0 ? " · vigente" : ""}
                          </Badge>
                          <span className="truncate">{v.name}</span>
                        </span>
                        <span className="shrink-0 text-[12px] text-muted">
                          {formatDate(v.uploadedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </fieldset>
        )}
      </Drawer>
    </div>
  );
}
