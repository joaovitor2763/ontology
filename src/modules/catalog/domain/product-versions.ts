import type { Product } from "./products.ts";
export type ProductVersion = {
  version: number;
  at: string;
  by: string;
  snapshot: Product;
};
export function versionProduct(
  previous: Product | undefined,
  next: Product,
  history: ProductVersion[],
  by: string,
  at: string,
) {
  const versions = [...history];
  if (!versions.length && previous)
    versions.push({
      version: previous.version ?? 1,
      at,
      by,
      snapshot: structuredClone({
        ...previous,
        version: previous.version ?? 1,
      }),
    });
  const version = (versions.at(-1)?.version ?? 0) + 1;
  const product = structuredClone({ ...next, version });
  versions.push({ version, at, by, snapshot: structuredClone(product) });
  return { product, versions };
}
