import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { getMe } from "@/lib/api";
import TopBar from "@/components/TopBar";
import Aurora from "@/components/Aurora";
import InstallPrompt from "@/components/InstallPrompt";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/");
  const me = await getMe();

  return (
    <>
      <Aurora />
      <div className="app-shell">
        <TopBar email={me?.email ?? user.email ?? "cuenta"} />
        {children}
      </div>
      <InstallPrompt />
    </>
  );
}
