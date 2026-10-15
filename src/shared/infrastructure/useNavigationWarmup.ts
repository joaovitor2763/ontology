"use client";

import { useEffect } from "react";
import { warmNavigation } from "./navigation-warmup.ts";
import { dropWarmReads } from "./persistence.ts";

/** Espera do mouse sobre o link antes de adiantar: passar por cima de uma lista não dispara nada. */
const HOVER_MS = 90;

/** Liga o adiantamento no shell: um ouvinte delegado para todos os links do app. */
export function useNavigationWarmup() {
  useEffect(() => {
    let timer: number | undefined;
    let target: HTMLAnchorElement | null = null;
    const anchorOf = (event: Event) => {
      const element = event.target instanceof Element ? event.target.closest("a[href]") : null;
      return element instanceof HTMLAnchorElement && !element.target && !element.hasAttribute("download") ? element : null;
    };
    const now = (anchor: HTMLAnchorElement | null) => { if (anchor) warmNavigation(anchor.href); };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const anchor = anchorOf(event);
      if (anchor === target) return;
      window.clearTimeout(timer);
      target = anchor;
      if (anchor) timer = window.setTimeout(() => now(anchor), HOVER_MS);
    };
    // Mouse: botão principal pressionado. Toque: só no clique (um arrasto para rolar
    // a lista começa sobre um cartão e não pode disparar leituras). O clique também
    // cobre Enter no teclado; a leitura sai junto com a troca de rota, não depois.
    const onDown = (event: PointerEvent) => { if (event.pointerType === "mouse" && event.button === 0) now(anchorOf(event)); };
    const onClick = (event: MouseEvent) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) now(anchorOf(event)); };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches(":focus-visible")) now(anchorOf(event));
    };
    const onCommitted = () => dropWarmReads();
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true, capture: true });
    document.addEventListener("focusin", onFocus);
    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener("ontology:execution-committed", onCommitted);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", onDown, { capture: true });
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("ontology:execution-committed", onCommitted);
    };
  }, []);
}
