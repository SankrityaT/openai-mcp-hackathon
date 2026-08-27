"use client";

import { useCallback, useMemo, useState } from "react";
import {
  MAX_PASS_AMOUNT_USD,
  MICROUNITS_PER_USD,
  STARTER_PASSES,
  type StarterPass,
  passById,
  toBudgetMicrounits,
} from "@/core/board/passes";

/**
 * Wallet state: which passes a mission may draw on, and the spending boundary
 * a person has loaded onto each one.
 *
 * This lives entirely on the device. There is no server, no network, and no
 * account behind it yet, so the hook must never imply the boundary is enforced
 * anywhere but here. When authority moves server-side, the same shape becomes
 * the request body rather than the source of truth.
 *
 * The board tree is mounted with `ssr: false` (see `board-mount.tsx`), so
 * storage is read once inside the `useState` initializer. Restoring in an
 * effect would paint an empty wallet first and then correct it, which reads as
 * a flicker on a surface whose whole point is that it remembers.
 */

export const WALLET_STORAGE_KEY = "cardea:wallet:v1";

/** The pass a first-run person is assumed to be acting as. */
const DEFAULT_SELECTED_DOMAIN = "personal";

export type WalletState = {
  selectedIds: string[];
  /** Loaded boundary per pass id, in USD. Absent means unloaded. */
  amounts: Record<string, number>;
};

export type Wallet = WalletState & {
  passes: readonly StarterPass[];
  toggle: (id: string) => void;
  load: (id: string, amountUsd: number) => void;
  totalLoadedUsd: number;
};

function defaultState(): WalletState {
  const personal = STARTER_PASSES.find((pass) => pass.domain === DEFAULT_SELECTED_DOMAIN);
  return { selectedIds: personal ? [personal.id] : [], amounts: {} };
}

/**
 * Read stored state defensively. Everything in `localStorage` is attacker
 * controlled in the sense that matters here: another script, an older build,
 * or a person editing devtools can put anything under the key. Unknown pass
 * ids and unusable amounts are dropped rather than trusted, and a parse
 * failure falls back to the first-run wallet instead of throwing during
 * render.
 */
export function readWalletState(raw: string | null): WalletState {
  if (!raw) return defaultState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultState();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultState();

  const record = parsed as { selectedIds?: unknown; amounts?: unknown };

  const selectedIds: string[] = [];
  if (Array.isArray(record.selectedIds)) {
    for (const id of record.selectedIds) {
      if (typeof id !== "string") continue;
      if (!passById(id)) continue;
      if (selectedIds.includes(id)) continue;
      selectedIds.push(id);
    }
  }

  const amounts: Record<string, number> = {};
  if (record.amounts && typeof record.amounts === "object" && !Array.isArray(record.amounts)) {
    for (const [id, value] of Object.entries(record.amounts as Record<string, unknown>)) {
      if (!passById(id)) continue;
      if (typeof value !== "number") continue;
      const usd = toBudgetMicrounits(value) / MICROUNITS_PER_USD;
      if (usd > 0) amounts[id] = usd;
    }
  }

  return { selectedIds, amounts };
}

/**
 * Write state back. Storage is a convenience, not a guarantee: private mode
 * and a full quota both throw on `setItem`, and neither is a reason to break
 * the wallet a person is currently using. The in-memory state stays correct
 * either way.
 */
function writeWalletState(state: WalletState) {
  try {
    window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable or full. The session continues unpersisted.
  }
}

export function useWallet(): Wallet {
  const [state, setState] = useState<WalletState>(() => {
    if (typeof window === "undefined") return defaultState();
    try {
      return readWalletState(window.localStorage.getItem(WALLET_STORAGE_KEY));
    } catch {
      // Reading storage itself can throw when cookies are blocked outright.
      return defaultState();
    }
  });

  const toggle = useCallback((id: string) => {
    if (!passById(id)) return;
    setState((current) => {
      const selected = current.selectedIds.includes(id);
      const next: WalletState = {
        ...current,
        selectedIds: selected
          ? current.selectedIds.filter((selectedId) => selectedId !== id)
          : [...current.selectedIds, id],
      };
      if (typeof window !== "undefined") writeWalletState(next);
      return next;
    });
  }, []);

  const load = useCallback((id: string, amountUsd: number) => {
    if (!passById(id)) return;
    const usd = toBudgetMicrounits(amountUsd) / MICROUNITS_PER_USD;
    setState((current) => {
      const amounts = { ...current.amounts };
      // An unloaded pass carries no entry at all, so clearing a boundary
      // cannot be confused with a boundary that happens to be zero.
      if (usd > 0) amounts[id] = usd;
      else delete amounts[id];
      const next: WalletState = { ...current, amounts };
      if (typeof window !== "undefined") writeWalletState(next);
      return next;
    });
  }, []);

  const totalLoadedUsd = useMemo(() => {
    const microunits = Object.values(state.amounts).reduce(
      (sum, usd) => sum + toBudgetMicrounits(usd),
      0,
    );
    return microunits / MICROUNITS_PER_USD;
  }, [state.amounts]);

  return {
    passes: STARTER_PASSES,
    selectedIds: state.selectedIds,
    amounts: state.amounts,
    toggle,
    load,
    totalLoadedUsd,
  };
}

export { MAX_PASS_AMOUNT_USD };
