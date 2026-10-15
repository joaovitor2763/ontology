"use client";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import {
  CompanyChrome,
  CompanyRecordChrome,
} from "@/modules/clients/presentation/CompanyChrome";
import { paths } from "@/shared/lib/routes";
import { NotFoundState } from "@g4ai/ds";
import { Button, Page } from "@/shared/ui/primitives";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";

export default function ClientLayout({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const path = usePathname();
  const { clientBySlug } = useClientsState();
  const client = clientBySlug(slug);
  if (!client)
    return (
      <Page>
        <NotFoundState
          title="Cliente não encontrado"
          description="Este endereço não corresponde a um cliente deste workspace."
          action={
            <Button href={paths.clients} size="sm">
              Ver clientes
            </Button>
          }
        />
      </Page>
    );
  /** `/clientes/[slug]/ciclos/[id]` and `/entregas/[id]` are records, not sections. */
  const parts = path.split("/").filter(Boolean);
  const record =
    parts.length >= 4 && (parts[2] === "ciclos" || parts[2] === "entregas");
  if (record)
    return <CompanyRecordChrome company={client}>{children}</CompanyRecordChrome>;
  return <CompanyChrome company={client}>{children}</CompanyChrome>;
}
