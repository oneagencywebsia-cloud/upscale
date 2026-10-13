import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import TopBar from "@/components/TopBar";
import Aurora from "@/components/Aurora";
import InstallPrompt from "@/components/InstallPrompt";
import MobileTabs from "@/components/MobileTabs";
import CoverTransitionProvider from "@/components/CoverTransition";
import ReferralBind from "@/components/ReferralBind";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/");

  return (
    <CoverTransitionProvider>
      <Aurora />
      <div className="app-shell">
        <TopBar email={user.email ?? "cuenta"} />
        {children}
      </div>
      <MobileTabs />
      <InstallPrompt />
      <ReferralBind />
    </CoverTransitionProvider>
  );
}
