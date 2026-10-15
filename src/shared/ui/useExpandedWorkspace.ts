"use client";

import { useEffect, type RefObject } from "react";

/** Isolate an expanded workspace without remounting its canvas or editors. */
export function useExpandedWorkspace(
  expanded: boolean,
  ref: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!expanded || !ref.current) return;
    const previousOverflow = document.body.style.overflow;
    const background: { element: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement = ref.current;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.setAttribute("inert", "");
        }
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    document.body.style.overflow = "hidden";
    return () => {
      for (const { element, inert } of background)
        element.toggleAttribute("inert", inert);
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded, ref]);
}
