'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from './api';
import { useConfirm } from '@/providers/ConfirmProvider';
import type { Lookup, LookupValue } from './types';

/**
 * The query parameter that names one document on a listing screen.
 *
 * How the approvals inbox hands an approver over to the document they have to
 * decide on: the inbox knows the screen (from the form the workflow is bound
 * to) and the id, and the screen knows how to open it. One name, so a link
 * built anywhere is understood everywhere.
 */
export const DOC_PARAM = 'doc';

/**
 * Open the document a link named — once, and then forget it.
 *
 * The parameter is stripped after opening, which matters more than it looks:
 * left in the URL, going Back to the listing would re-open the document the
 * user had just closed, and a refresh would fight anyone who had moved on.
 *
 * `open` is called with the id alone. Every screen that uses this already has a
 * way to load one document by id — none of them needs the row it came from.
 */
export function useDocumentLink(open: (id: number) => void) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const opened = useRef(false);

  const id = Number(params.get(DOC_PARAM));

  useEffect(() => {
    if (opened.current || !Number.isInteger(id) || id <= 0) return;
    // Guarded by a ref rather than by the deps: `open` is a fresh closure on
    // every render, and a document must be opened once however often this runs.
    opened.current = true;
    open(id);
    router.replace(pathname, { scroll: false });
  }, [id, open, router, pathname]);
}

/**
 * Simple GET hook with manual refetch. Safe to use in client components.
 * It does not run during SSR (effect only fires in the browser).
 */
export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<T>(path);
      setData(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return; // redirect handled globally
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, refetch, setData };
}

// Guards mounted right now. A screen and the drawer open on top of it each hold
// one, so they are pooled: any of them being dirty blocks the navigation, and
// whichever listener gets there first owns the single prompt the user sees.
const dirtyChecks = new Set<() => boolean>();
// A confirm dialog is already up — the other guards must not stack a second one.
let prompting = false;
// The user has agreed to go. The page can still re-render while the router
// transitions, and it must not ask again on the way out.
let leaving = false;
const anyDirty = () => !leaving && [...dirtyChecks].some((check) => check());

/**
 * Guards a form with unsaved edits against leaving the page.
 *
 * An editor screen that only checks on its own Back button leaks work: the
 * sidebar, the topbar and the browser all navigate straight past it. This
 * covers the three ways out of a page:
 *
 *   • an in-app link (sidebar menu, breadcrumb, any `<Link>`) — the App Router
 *     exposes no route-change event to cancel, so the click on the underlying
 *     `<a>` is caught in the capture phase, before Next handles it, and the
 *     navigation is re-issued only once the user confirms;
 *   • a browser refresh / tab close — the native beforeunload prompt;
 *   • the screen's own Back button — call the returned `leave(href)`.
 *
 * `isDirty` is read through a ref, so it can be an inline closure over the
 * current state without re-registering the listeners on every keystroke.
 *
 * Not covered: the browser's own Back/Forward buttons, which cannot be
 * cancelled without hijacking the history stack.
 */
export function useUnsavedChangesGuard(isDirty: () => boolean) {
  const router = useRouter();
  const confirm = useConfirm();

  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  useEffect(() => {
    const check = () => dirtyRef.current();
    dirtyChecks.add(check);
    leaving = false;
    return () => {
      dirtyChecks.delete(check);
      if (dirtyChecks.size === 0) leaving = false;
    };
  }, []);

  const confirmDiscard = useCallback(async () => {
    if (!anyDirty()) return true;
    if (prompting) return false; // another guard is already asking
    prompting = true;
    try {
      return await confirm({
        title: 'Unsaved changes',
        message:
          'There are unsaved changes. If you leave this page, they will be lost. Continue?',
        danger: true,
        confirmText: 'Yes',
        cancelText: 'No',
        defaultCancel: true,
      });
    } finally {
      prompting = false;
    }
  }, [confirm]);

  /** Ask, then navigate. Returns false when the user chose to stay. */
  const leave = useCallback(
    async (href: string) => {
      if (!(await confirmDiscard())) return false;
      leaving = true;
      router.push(href);
      return true;
    },
    [confirmDiscard, router],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!anyDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    };

    const onClick = (e: MouseEvent) => {
      // Leave anything that is not a plain left-click alone: modified clicks and
      // middle-clicks open a new tab, so this page is not going anywhere.
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.('a');
      if (
        !anchor ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download')
      ) {
        return;
      }
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const to = `${url.pathname}${url.search}`;
      if (to === `${window.location.pathname}${window.location.search}`) return;
      if (!anyDirty()) return;
      // Stop the click at the capture phase so Next never starts the
      // navigation; it is replayed with router.push once the user says yes.
      e.preventDefault();
      e.stopPropagation();
      void leave(to);
    };

    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', onClick, true);
    };
  }, [leave]);

  return { confirmDiscard, leave };
}

/**
 * The ACTIVE values of a lookup, found by its code (e.g. 'DISCOUNT_LEVEL').
 *
 * Values live one level below the lookup itself, so reaching them means finding
 * the lookup by code first and then fetching its values — two calls that every
 * screen using a lookup-driven list would otherwise repeat. An unknown code
 * yields an empty list rather than an error: a lookup the user has deleted
 * should leave a screen empty, not broken.
 *
 * Sorted by the lookup's own sortOrder, so the order shown is the order the
 * user arranged in Lookups.
 */
export function useLookupValues(code: string) {
  const { data: lookups } = useFetch<Lookup[]>('/lookups');
  const [values, setValues] = useState<LookupValue[]>([]);

  useEffect(() => {
    const lookup = (lookups ?? []).find((l) => l.code === code);
    if (!lookup) {
      setValues([]);
      return;
    }
    let cancelled = false;
    api
      .get<LookupValue[]>(`/lookups/${lookup.id}/values`)
      .then((vals) => {
        if (cancelled) return;
        setValues(
          (vals ?? [])
            .filter((v) => v.isActive)
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
        );
      })
      .catch(() => {
        if (!cancelled) setValues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lookups, code]);

  return values;
}
