"use client";
import { useState } from "react";
import type { Company } from "../domain/models";
import { clientInitials, validClientLogo } from "../domain/identity";
import { ClientMark } from "./ClientMark";
import { FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";

export function ClientIdentityFields({ client, onChange, onBusy }: {
  client: Company; onBusy: (busy: boolean) => void; onChange: (patch: Pick<Company, "initials" | "logo">) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5_000_000) {
      setError("Escolha uma imagem PNG, JPG ou WebP de até 5 MB."); return;
    }
    setBusy(true); onBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 128;
        const context = canvas.getContext("2d");
        if (!context) throw new Error();
        const scale = 128 / Math.max(bitmap.width, bitmap.height);
        const width = bitmap.width * scale, height = bitmap.height * scale;
        context.drawImage(bitmap, (128 - width) / 2, (128 - height) / 2, width, height);
        const logo = canvas.toDataURL("image/webp", 0.8);
        if (!validClientLogo(logo)) throw new Error();
        onChange({ initials: client.initials, logo });
      } finally { bitmap.close(); }
    } catch { setError("Não foi possível preparar essa imagem. Tente outra imagem."); }
    finally { setBusy(false); onBusy(false); }
  }
  return <FieldBlock label="Logo do cliente">
    <div className="flex items-center gap-3">
      <ClientMark company={client} className="h-12 w-12 text-base" />
      <input className={fieldClass} aria-label="Dois caracteres do cliente" disabled={busy} maxLength={2}
        placeholder={clientInitials(client.name)} value={client.initials ?? ""}
        onChange={(event) => onChange({ initials: event.target.value.toUpperCase(), logo: client.logo })} />
    </div>
    <p className="mt-2 text-xs text-muted">Use dois caracteres ou deixe vazio para gerar pelo nome. A imagem tem preferência sobre os caracteres.</p>
    <input aria-label="Enviar logo do cliente" type="file" accept="image/png,image/jpeg,image/webp"
      disabled={busy} className="mt-3 block w-full text-sm"
      onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
    <p className="mt-1 text-xs text-muted">{busy ? "Preparando imagem…" : "PNG, JPG ou WebP, até 5 MB. A imagem será reduzida para carregar rapidamente."}</p>
    {client.logo && <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ initials: client.initials, logo: "" })}>Remover imagem e usar caracteres</Button>}
    {error && <p role="alert" className="mt-2 text-sm text-rose">{error}</p>}
  </FieldBlock>;
}
