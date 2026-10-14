import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { getAsset } from "@/lib/api";
import { profileOf } from "@/lib/profile";
import TopBar from "@/components/TopBar";
import Aurora from "@/components/Aurora";
import InstallPrompt from "@/components/InstallPrompt";
import MobileTabs from "@/components/MobileTabs";
import CoverTransitionProvider from "@/components/CoverTransition";
import ReferralBind from "@/components/ReferralBind";
import DownloadProgress from "@/components/DownloadProgress";

export const dynamic = "force-dynamic";

// la biblioteca es privada: que ningún buscador la indexe
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/");

  const profile = profileOf(user);
  // solo quien eligió una foto de su biblioteca como avatar paga esta petición
  let photoUrl: string | null = null;
  if (profile.avatar.style === "photo" && profile.avatar.a) {
    photoUrl = await getAsset(profile.avatar.a)
      .then((a) => a.thumbUrl)
      .catch(() => null);
  }

  return (
    <CoverTransitionProvider>
      <Aurora />
      <div className="app-shell">
        <TopBar profile={profile} photoUrl={photoUrl} />
        {children}
      </div>
      <MobileTabs profile={profile} photoUrl={photoUrl} />
      <InstallPrompt />
      <ReferralBind />
      <DownloadProgress />
    </CoverTransitionProvider>
  );
}
