import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./legal.module.css";

export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Link className={styles.brand} href="/">
          <img src="/images/cardea/logo-mark.png" alt="" width={256} height={256} />
          <span>Cardea</span>
        </Link>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.updated}>Last updated {updated}</p>
        <div className={styles.body}>{children}</div>
        <div className={styles.footer}>
          <Link href="/">Home</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </div>
    </main>
  );
}
