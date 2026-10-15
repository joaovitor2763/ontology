"use client";
import { useEffect, useRef, useState } from "react";
import type { JourneyTemplate } from "@/modules/catalog/domain/models";
import { milestoneByN } from "@/modules/catalog/infrastructure/journey";
import type { Delivery } from "@/modules/delivery/domain/models";
import { type Filter, scrollParentOf } from "./shared";

/** Which milestone is open, what is being edited and the filters of its task list. */
export function useJourneyState({
  journey,
  currentMilestone,
  initialMilestone,
}: {
  journey: JourneyTemplate;
  currentMilestone: number;
  initialMilestone?: number;
}) {
  const [selected, setSelected] = useState<number | null>(
    initialMilestone ?? null,
  );
  const open = journey.milestones.some((item) => item.n === selected)
    ? selected!
    : currentMilestone;
  const m = milestoneByN(open, journey);
  const [editing, setEditing] = useState<Delivery | null>(null);
  const [creating, setCreating] = useState(false);
  const [review, setReview] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  /** Deliveries outside any cycle stay folded while the milestone has cycles. */
  const [showLoose, setShowLoose] = useState(false);
  const [notice, setNotice] = useState("");
  /** Milestone under the pointer in the compact rail; its name shows in the line below. */
  const [peek, setPeek] = useState<number | null>(null);
  const [justification, setJustification] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const stepperRef = useRef<HTMLOListElement>(null);
  const [railWidth, setRailWidth] = useState<number | null>(null);

  useEffect(() => {
    const list = stepperRef.current;
    if (!list) return;
    const observer = new ResizeObserver(([entry]) =>
      setRailWidth(entry.contentRect.width),
    );
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const list = stepperRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (list && active)
      active.scrollIntoView({ block: "nearest", inline: "center" });
  }, [open]);

  function navigate(n: number) {
    setSelected(n);
    setFilter("all");
    setQuery("");
    setShowLoose(false);
    setEditing(null);
    scrollParentOf(contentRef.current)?.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  return {
    open,
    m,
    navigate,
    editing,
    setEditing,
    creating,
    setCreating,
    review,
    setReview,
    filter,
    setFilter,
    query,
    setQuery,
    showLoose,
    setShowLoose,
    notice,
    setNotice,
    peek,
    setPeek,
    justification,
    setJustification,
    contentRef,
    stepperRef,
    railWidth,
  };
}
