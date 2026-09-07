import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import Landing from "@/components/landing/Landing";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getUser();
  const { next } = await searchParams;
  if (user && !next) redirect("/app");
  return <Landing loggedIn={Boolean(user)} next={next ?? "/app"} />;
}
