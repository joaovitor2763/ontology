import { FacetFilter } from "@/shared/ui/FacetFilter";
import { NO_RESPONSIBLE } from "../domain/responsibility-filters";

type Member = { id: string; name: string };
export function ResponsibleFilters({ members, active, client, product, onClient, onProduct, showProduct }: {
  showProduct: boolean; members: Member[]; active: Member[]; client: string[]; product: string[];
  onClient: (ids: string[]) => void; onProduct: (ids: string[]) => void;
}) {
  const options = [{ id: NO_RESPONSIBLE, label: "Sem responsável" }, ...members
    .filter(member => active.some(row => row.id === member.id) || client.includes(member.id) || product.includes(member.id))
    .map(member => ({ id: member.id, label: member.name }))];
  return <><FacetFilter label="Responsável pelo cliente" options={options} value={client} onChange={onClient} />
    {showProduct && <FacetFilter label="Responsável pelo produto" options={options} value={product} onChange={onProduct} />}</>;
}
