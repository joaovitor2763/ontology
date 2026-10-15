"use client";
import { glossary, paths } from "@/shared/lib/routes";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { Flag, Package } from "lucide-react";
import { useRouter } from "next/navigation";

/** Produtos e Planos são as duas metades do catálogo; o controle troca de rota. */
export function CatalogSwitcher({ value }: { value: "produtos" | "planos" }) {
  const router = useRouter();
  return (
    <SegmentedControl
      label="Área do catálogo"
      value={value}
      onChange={(next) =>
        router.push(
          next === "produtos" ? paths.catalogProducts() : paths.catalogPlans(),
        )
      }
      options={[
        {
          value: "produtos",
          label: glossary.products,
          icon: <Package className="h-3.5 w-3.5" />,
        },
        {
          value: "planos",
          label: glossary.plans,
          icon: <Flag className="h-3.5 w-3.5" />,
        },
      ]}
    />
  );
}
