"use client";

import { usePersonalPreference } from "@/shared/infrastructure/usePersonalPreference";
import { Combobox } from "@/shared/ui/Combobox";
import { Modal } from "@/shared/ui/Dialog";
import { Button, Checkbox, IconButton, TextField } from "@g4ai/ds";
import { BookmarkPlus, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type SavedView<T> = { id: string; name: string; filters: T };
type SavedCollection<T> = { views: SavedView<T>[]; defaultId: string };
const EMPTY: SavedCollection<unknown> = { views: [], defaultId: "" };
const localKeys = new Map<string, (owner: string) => string>();
function localKeyFor(scope: string) {
  let key = localKeys.get(scope);
  if (!key) { key = (owner: string) => `ontology.saved-views.v1.${owner}.${scope}`; localKeys.set(scope, key); }
  return key;
}

/** Visões pessoais usam a identidade resolvida, nunca um membro de exemplo durante o login, e acompanham a conta. */
export function SavedViews<T extends object>({ scope, current, onApply, localOwner, initialOverride = false }: {
  scope: string;
  current: T;
  onApply: (filters: T) => void;
  localOwner: string;
  initialOverride?: boolean;
}) {
  const [stored, setStored, owner] = usePersonalPreference<SavedCollection<T>>(
    `saved-views.${scope}`, localKeyFor(scope), EMPTY as SavedCollection<T>, localOwner);
  const key = owner ? localKeyFor(scope)(owner) : null;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [asDefault, setAsDefault] = useState(false);
  const appliedKey = useRef<string | null>(null);
  const applyRef = useRef(onApply);
  useEffect(() => { applyRef.current = onApply; }, [onApply]);
  useEffect(() => {
    if (!owner || appliedKey.current === key || !stored.defaultId) return;
    const preferred = stored.views.find((view) => view.id === stored.defaultId);
    if (!preferred) return;
    appliedKey.current = key;
    if (preferred && !initialOverride) applyRef.current(preferred.filters);
  }, [owner, key, stored, initialOverride]);
  if (!owner) return null;

  const validViews = Array.isArray(stored.views) ? stored.views.filter((view) =>
    view && typeof view.id === "string" && typeof view.name === "string" && view.filters && typeof view.filters === "object",
  ) : [];
  const selected = validViews.find((view) => JSON.stringify(view.filters) === JSON.stringify(current));
  const save = () => {
    const label = name.trim().slice(0, 60);
    if (!label) return;
    const view: SavedView<T> = { id: crypto.randomUUID(), name: label, filters: current };
    setStored((state) => ({ views: [...(Array.isArray(state.views) ? state.views : []), view],
      defaultId: asDefault ? view.id : state.defaultId }));
    setName("");
    setAsDefault(false);
    setOpen(false);
  };
  return <>
    <div className="flex shrink-0 items-center gap-1.5" aria-label="Visões salvas">
      <Combobox label="Visão salva" value={selected?.id ?? "custom"}
        onValueChange={(id) => { const view = validViews.find((item) => item.id === id); if (view) onApply(view.filters); }}
        options={[{ value: "custom", label: "Visão personalizada" }, ...validViews.map((view) => ({
          value: view.id, label: view.id === stored.defaultId ? `${view.name} (padrão)` : view.name }))]} />
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title="Salvar filtros atuais">
        <BookmarkPlus className="h-4 w-4" /><span className="hidden sm:inline">Salvar visão</span>
      </Button>
      {selected && <>
        {stored.defaultId === selected.id ? (
          <Button variant="ghost" size="sm" onClick={() => setStored((state) => ({ ...state, defaultId: "" }))}
            aria-label="Deixar de usar esta visão como padrão" title="Esta visão abre por padrão. Clique para desfazer.">
            <Star className="h-4 w-4" fill="currentColor" /><span className="hidden sm:inline">Padrão</span>
          </Button>
        ) : (
          <Button variant="quiet" size="sm" onClick={() => setStored((state) => ({ ...state, defaultId: selected.id }))}
            aria-label="Tornar esta visão o padrão" title="Abrir sempre com esta visão">
            <Star className="h-4 w-4" /><span className="hidden sm:inline">Tornar padrão</span>
          </Button>
        )}
        <IconButton label="Excluir esta visão" className="hover:text-rose" onClick={() => setStored((state) => ({
          views: state.views.filter((view) => view.id !== selected.id),
          defaultId: state.defaultId === selected.id ? "" : state.defaultId,
        }))}>
          <Trash2 />
        </IconButton>
      </>}
    </div>
    <Modal open={open} onClose={() => setOpen(false)} title="Salvar visão" description="Guarde estes filtros para usar depois, em qualquer aparelho em que você entrar."
      footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={save} disabled={!name.trim()} disabledReason="Dê um nome à visão">Salvar</Button></>}>
      <TextField id={`view-name-${scope}`} label="Nome da visão" autoFocus value={name} maxLength={60} onChange={setName}
        onKeyDown={(event) => { if (event.key === "Enter") save(); }} placeholder="Ex.: Meus clientes" />
      <div className="mt-3">
        <Checkbox label="Abrir sempre com esta visão" checked={asDefault} onCheckedChange={setAsDefault} />
      </div>
    </Modal>
  </>;
}
