import type { Metadata } from "next";
import WidgetBuilder from "@/components/widgets/WidgetBuilder";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Widget" };

export default async function WidgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WidgetBuilder id={id} />;
}
