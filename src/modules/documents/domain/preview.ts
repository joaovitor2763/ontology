/** Small previews only; active document formats are never rendered as HTML. */
export function documentPreviewKind(name: string, mime = ""): "text" | "image" | "pdf" | null {
  const type = mime.split(";")[0].toLowerCase();
  if (["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(type)) return "image";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("text/") || ["application/json", "application/xml"].includes(type) || /\.(txt|md|csv|log|json|xml)$/i.test(name)) return "text";
  return null;
}
export const previewLimit = (kind: "text" | "image" | "pdf") => kind === "text" ? 1_000_000 : 5_000_000;
export const PREVIEW_TEXT_CHARS = 40_000;
