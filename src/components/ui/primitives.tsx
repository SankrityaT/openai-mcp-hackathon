import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type ButtonTone = "primary" | "secondary" | "quiet" | "coral";

function buttonClass(tone: ButtonTone, className?: string) {
  return ["button", `button--${tone}`, className].filter(Boolean).join(" ");
}

export function ButtonLink({
  tone = "primary",
  className,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  tone?: ButtonTone;
  children: ReactNode;
}) {
  return (
    <a className={buttonClass(tone, className)} {...props}>
      {children}
    </a>
  );
}

export function Button({
  tone = "primary",
  className,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
  children: ReactNode;
}) {
  return (
    <button type={type} className={buttonClass(tone, className)} {...props}>
      {children}
    </button>
  );
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="icon icon--arrow">
      <path d="M3 9h11M10 5l4 4-4 4" />
    </svg>
  );
}

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      role="img"
      aria-label="Cardea"
      className={["logo-mark", className].filter(Boolean).join(" ")}
    >
      <circle cx="20" cy="20" r="17.5" className="logo-mark__disc" />
      <path d="M12 31V17.5a8 8 0 0 1 16 0V31" className="logo-mark__arch" />
      <path d="M6.5 22.5c6.4-8.2 14.4-9.8 27-4.2" className="logo-mark__orbit" />
      <circle cx="28.2" cy="18.3" r="2.2" className="logo-mark__hinge" />
      <path d="M15 26.7c2.3-1.3 4.1-3.8 4.8-7.8 1.5 4 3.2 6.6 5.5 8" className="logo-mark__profile" />
    </svg>
  );
}

export function StatusDot({ tone = "blue" }: { tone?: "blue" | "coral" | "green" | "neutral" }) {
  return <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />;
}

export function DemoBadge({ children = "Demo fixture" }: { children?: ReactNode }) {
  return <span className="demo-badge">{children}</span>;
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="icon">
      <path d="m3.5 9.4 3.2 3.1 7.8-7.3" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="icon">
      <path d="M6 4.5v9M12 4.5v9" />
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="icon">
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 1.7v2M10 16.3v2M1.7 10h2M16.3 10h2M4.1 4.1l1.4 1.4M14.5 14.5l1.4 1.4M15.9 4.1l-1.4 1.4M5.5 14.5l-1.4 1.4" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="icon">
      <path d="M16.6 12.7a6.6 6.6 0 0 1-9.3-9.3A7 7 0 1 0 16.6 12.7Z" />
    </svg>
  );
}
