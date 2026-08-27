import type { Metadata } from "next";
import { BoardMount } from "./_components/board-mount";

export const metadata: Metadata = {
  title: "Cardea board",
  description: "The infinite Cardea board.",
};

export default function AppPage() {
  return <BoardMount />;
}
