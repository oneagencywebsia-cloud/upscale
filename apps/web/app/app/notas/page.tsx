import type { Metadata } from "next";
import NotesApp from "@/components/notes/NotesApp";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notas" };

export default function NotasPage() {
  return <NotesApp />;
}
