"use client";
import {
  attachmentRepository,
  downloadAttachment,
} from "@/modules/documents/infrastructure/attachments";
import type { ThreadFile } from "@/modules/engagement/domain/models";
import { cn } from "@/shared/lib/cn";
import { Paperclip } from "lucide-react";
import { useEffect, useState } from "react";

export function Attachs({
  files,
  docs,
  align = "left",
}: {
  files?: string[];
  docs?: ThreadFile[];
  align?: "left" | "right";
}) {
  if ((!files || files.length === 0) && (!docs || docs.length === 0)) return null;
  return (
    <div
      className={cn(
        "mt-2 flex flex-wrap gap-1.5",
        align === "right" && "justify-end",
      )}
    >
      {docs?.map((f) => <StoredFile key={f.id} file={f} />)}
      {files?.map((f) => (
        <span
          key={f}
          className="inline-flex items-center gap-1.5 rounded-full bg-rose-soft px-2.5 py-1 text-[12px] text-rose"
        >
          <Paperclip className="h-3 w-3" />
          {f}
        </span>
      ))}
    </div>
  );
}

/** A file kept as a document of the client: images show inline, the rest downloads. */
export function StoredFile({ file }: { file: ThreadFile }) {
  const image = file.mime.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!image) return;
    let revoke: string | null = null;
    let active = true;
    attachmentRepository
      .get(file.id)
      .then((blob) => {
        if (!active || !blob) return;
        revoke = URL.createObjectURL(blob);
        setUrl(revoke);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [file.id, image]);
  function open() {
    setFailed(false);
    downloadAttachment(file.id, file.name).catch(() => setFailed(true));
  }
  if (image && url)
    return (
      <button
        type="button"
        onClick={open}
        title={`${file.name} · baixar`}
        className="block basis-full overflow-hidden rounded-xl ring-1 ring-line"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- blob URL from the attachment store */}
        <img
          src={url}
          alt={file.name}
          className="max-h-[320px] w-auto max-w-full object-contain"
        />
      </button>
    );
  return (
    <button
      type="button"
      onClick={open}
      title={failed ? "Conteúdo indisponível" : `${file.name} · baixar`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ring-1 ring-line hover:bg-soft",
        failed ? "text-rose" : "text-ink-soft",
      )}
    >
      <Paperclip className="h-3 w-3" />
      {file.name}
    </button>
  );
}
