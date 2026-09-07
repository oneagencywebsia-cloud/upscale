import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";
import Landing from "@/components/landing/Landing";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getUser();
  const { next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  if (user && !rawNext) redirect("/app");
  return <Landing loggedIn={Boolean(user)} next={next} />;
}
