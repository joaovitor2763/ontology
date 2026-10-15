"use client";
import Link from "next/link";
import { paths } from "@/shared/lib/routes";
import { PainList, SolutionList } from "../DiagnosisLists";
import type { Pain, Solution } from "@/modules/engagement/domain/models";

export function PainsSection({
  company,
  pains,
  solutions,
}: {
  company: string;
  pains: Pain[];
  solutions: Solution[];
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium">Dores identificadas</h2>
        <Link
          href={paths.clientAgenda(company)}
          className="text-[12.5px] text-muted hover:text-ink"
        >
          Diagnóstico do cliente
        </Link>
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl border border-line">
        <PainList
          pains={pains}
          solutions={solutions}
          emptyHint="Nenhuma dor registrada nesta reunião."
        />
      </div>
    </section>
  );
}

export function SolutionsSection({
  solutions,
  companyPains,
}: {
  solutions: Solution[];
  companyPains: Pain[];
}) {
  return (
    <section>
      <h2 className="text-[15px] font-medium">Soluções propostas</h2>
      <div className="mt-3 overflow-hidden rounded-2xl border border-line">
        <SolutionList
          solutions={solutions}
          pains={companyPains}
          emptyHint="Nenhuma solução proposta nesta reunião."
        />
      </div>
    </section>
  );
}
