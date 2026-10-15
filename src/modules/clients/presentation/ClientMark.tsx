"use client";
import type { Company } from "../domain/models";
import { clientInitials, validClientLogo } from "../domain/identity";
import { cn } from "@/shared/lib/cn";

export function ClientMark({ company, className }: { company: Pick<Company, "name" | "tint" | "initials" | "logo">; className?: string }) {
  return <span className={cn("company-avatar grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-tile text-[13px] font-medium", className)}
    style={{ background: `${company.tint}10`, color: company.tint }} aria-hidden="true">
    {company.logo && validClientLogo(company.logo) ?
      // eslint-disable-next-line @next/next/no-img-element
      <img src={company.logo} alt="" className="h-full w-full object-contain" />
      : clientInitials(company.name, company.initials)}
  </span>;
}
