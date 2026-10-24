import type { Metadata } from "next";
import NoteEditor from "@/components/notes/NoteEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nota" };

export default async function NotaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NoteEditor id={id} />;
}
