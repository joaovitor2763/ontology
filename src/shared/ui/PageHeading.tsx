import { Crumbs } from "@/modules/workspace/presentation/Crumbs";
import { cn } from "@/shared/lib/cn";
import { PageHeading as DsPageHeading, StickyHeader, type Crumb } from "@g4ai/ds";
import type { ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  actions?: ReactNode;
  compact?: boolean;
  sticky?: boolean;
  /** Trilha derivada do endereço (só ancestrais). Padrão: ligada fora do modo compacto. */
  breadcrumb?: boolean;
  /** Trilha explícita; quando informada, substitui a derivada do endereço. */
  crumbs?: Crumb[];
  /** Linha acima do título (ex.: data na home). */
  kicker?: ReactNode;
};

/**
 * `PageHeading` do G4OS-DS com a trilha do Delivery: sem `crumbs` explícitos,
 * a trilha vem de `Crumbs`, que deriva os ancestrais do endereço e só lê os
 * documentos nas rotas que têm trilha. A marcação é a mesma do DS.
 */
export function PageHeading({ compact = false, breadcrumb = !compact, crumbs, ...props }: Props) {
  if (crumbs || !breadcrumb) return <DsPageHeading compact={compact} crumbs={crumbs} {...props} />;
  const { title, description, actions, sticky = true, kicker } = props;
  const Heading = compact ? "h2" : "h1";
  return (
    <StickyHeader enabled={sticky} className={cn("page-heading", compact && "page-heading-compact")}>
      <Crumbs className="page-heading-crumbs" />
      <div className="min-w-0">
        {kicker && <p className="m-0 mb-2 text-[11px] text-muted first-letter:uppercase">{kicker}</p>}
        <Heading>{title}</Heading>
        {description && <p data-header-description="">{description}</p>}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </StickyHeader>
  );
}
