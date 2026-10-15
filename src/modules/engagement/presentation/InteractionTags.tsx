"use client";
import { interactionTags, interactionTagLabel, normalizeInteractionTags, type InteractionTag } from "@/modules/engagement/domain/interaction-tags";
import { cn } from "@/shared/lib/cn";

export function InteractionTagPicker({ value, onChange }: { value: InteractionTag[]; onChange: (tags: InteractionTag[]) => void }) {
  return (
    <fieldset className="my-3">
      <legend className="mb-2 text-[12px] text-muted">Tags · opcional</legend>
      <div className="flex flex-wrap gap-1.5">
        {interactionTags.map((tag) => (
          <button key={tag} type="button" aria-pressed={value.includes(tag)}
            onClick={() => onChange(normalizeInteractionTags(value.includes(tag) ? value.filter((item) => item !== tag) : [...value, tag]))}
            className={cn("rounded-full border px-2.5 py-1 text-[12px] transition-colors", value.includes(tag) ? "border-ink bg-ink text-on-ink" : "border-line bg-surface text-ink-soft hover:bg-soft")}>
            {interactionTagLabel[tag]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function InteractionTagBadges({ tags }: { tags?: InteractionTag[] }) {
  const values = normalizeInteractionTags(tags);
  if (!values.length) return null;
  return <ul aria-label="Tags da interação" className="mt-2 flex flex-wrap gap-1.5">
    {values.map((tag) => <li key={tag} className="rounded-full border border-line bg-soft px-2 py-0.5 text-[11.5px] text-ink-soft">{interactionTagLabel[tag]}</li>)}
  </ul>;
}
