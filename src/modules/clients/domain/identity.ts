export function clientInitials(name: string, custom = ""): string {
  const clean = (value: string) => Array.from(value.trim().toUpperCase().replace(/\s+/g, ""));
  if (clean(custom).length === 2) return clean(custom).join("");
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [clean(words[0])[0], clean(words.at(-1)!)[0]] : clean(name).slice(0, 2);
  return letters.filter(Boolean).join("").padEnd(2, "—");
}

export function validClientLogo(value: string): boolean {
  return value.length <= 32_000 && /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(value);
}
