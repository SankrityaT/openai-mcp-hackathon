"use client";

import { useRef } from "react";
import { MoonIcon, SunIcon } from "@/components/ui/primitives";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const buttonRef = useRef<HTMLButtonElement>(null);

  function toggleTheme() {
    const nextTheme: Theme = currentTheme() === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const bounds = buttonRef.current?.getBoundingClientRect();
    const x = bounds ? bounds.left + bounds.width / 2 : window.innerWidth;
    const y = bounds ? bounds.top + bounds.height / 2 : 0;
    root.style.setProperty("--theme-x", `${x}px`);
    root.style.setProperty("--theme-y", `${y}px`);

    const apply = () => {
      root.dataset.theme = nextTheme;
      localStorage.setItem("cardea-theme", nextTheme);
    };

    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("startViewTransition" in document)
    ) {
      apply();
      return;
    }

    const transitionDocument = document as Document & {
      startViewTransition(callback: () => void): { finished: Promise<void> };
    };
    transitionDocument.startViewTransition(apply);
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label="Toggle color theme"
      title="Toggle color theme"
    >
      <span className="theme-toggle__icon theme-toggle__moon" aria-hidden="true"><MoonIcon /></span>
      <span className="theme-toggle__icon theme-toggle__sun" aria-hidden="true"><SunIcon /></span>
    </button>
  );
}
