import type { Metadata } from "next";
import WidgetsApp from "@/components/widgets/WidgetsApp";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Widgets" };

export default function WidgetsPage() {
  return <WidgetsApp />;
}
