"use client";

import dynamic from "next/dynamic";

/**
 * The board is pure client surface: it reads localStorage and measures the
 * viewport before it can draw anything meaningful. Skipping SSR lets it seed
 * its state directly from storage instead of restoring in an effect, which
 * would otherwise flash an empty board and cascade a second render.
 */
const CardeaBoard = dynamic(() => import("./board").then((m) => m.CardeaBoard), {
  ssr: false,
});

export function BoardMount() {
  return <CardeaBoard />;
}
