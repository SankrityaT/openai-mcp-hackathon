"use client";

/**
 * The board's last line of defense. A single bad recorded value must degrade
 * to this card, never to Next's default dead screen, because a wedged board
 * with no way back is the worst thing a live mission surface can show.
 * The reset re-renders the segment in place; the mission itself is durable
 * server state and loses nothing.
 */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        textAlign: "center",
        fontFamily: "var(--font-geist), Arial, sans-serif",
        color: "var(--ink, #1c1a17)",
        background: "var(--surface, #f7f4ee)",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
        The board hit something it could not render.
      </h1>
      <p style={{ margin: 0, maxWidth: 440, fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
        Your mission is safe on the server. Reload the board and it picks up
        exactly where the record left off.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          minHeight: 44,
          padding: "0 22px",
          border: "1px solid transparent",
          borderRadius: 8,
          background: "var(--blue, #2456d6)",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Reload the board
      </button>
    </main>
  );
}
