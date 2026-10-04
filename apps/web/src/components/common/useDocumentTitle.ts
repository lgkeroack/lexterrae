import { useEffect } from 'react';

export const APP_NAME = 'Lex Terrae';

export function formatTitle(title?: string | null): string {
  return title ? `${title} · ${APP_NAME}` : APP_NAME;
}

/**
 * Set the browser tab title for the current page. AppLayout sets a per-route
 * default in a layout effect; pages can call this to refine it (e.g. with a
 * document's name), since passive effects run after layout effects.
 */
export function useDocumentTitle(title?: string | null): void {
  useEffect(() => {
    if (title) document.title = formatTitle(title);
  }, [title]);
}
