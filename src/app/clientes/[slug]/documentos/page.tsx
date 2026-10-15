"use client";
import { FilesPanel } from "@/modules/documents/presentation/FilesPanel";
import { PageHeading } from "@/shared/ui/PageHeading";
import { useParams } from "next/navigation";

export default function ClientDocumentos() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div>
      <PageHeading
        compact
        title="Documentos"
        description="Contratos, atas e evidências deste cliente, conectados às entregas e reuniões."
      />
      <div className="mt-5">
        <FilesPanel company={slug} />
      </div>
    </div>
  );
}
