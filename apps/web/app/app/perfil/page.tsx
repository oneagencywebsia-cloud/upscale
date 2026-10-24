import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { getAsset, getStorage, listAlbums, listTokens, getIngestAccess } from "@/lib/api";
import { bytesHuman } from "@/lib/format";
import { profileOf } from "@/lib/profile";
import Avatar from "@/components/Avatar";
import IngestBind from "@/components/IngestBind";
import ProfileForm from "@/components/profile/ProfileForm";
import AccountSecurity from "@/components/profile/AccountSecurity";
import Preferences from "@/components/profile/Preferences";
import ExportData from "@/components/profile/ExportData";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Perfil" };

const PROVIDER_LABEL: Record<string, string> = { google: "Google", apple: "Apple", email: "Correo" };
const DAY = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });
const DAY_TIME = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
});

const fmt = (f: Intl.DateTimeFormat, iso?: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? f.format(d) : "—";
};

export default async function PerfilPage() {
  const user = await getUser();
  if (!user) redirect("/");

  const profile = profileOf(user);
  // la ingesta de Telegram es solo del administrador: el resto no ve ni nombra esa conexión
  const telegram = await getIngestAccess();
  const verTelegram = telegram.isYou || telegram.canBind;
  const providers: string[] = Array.isArray(user.app_metadata?.providers)
    ? (user.app_metadata.providers as string[])
    : user.app_metadata?.provider
      ? [String(user.app_metadata.provider)]
      : [];

  const [storage, albums, tokens, photo] = await Promise.allSettled([
    getStorage(),
    listAlbums(),
    listTokens(),
    profile.avatar.style === "photo" && profile.avatar.a ? getAsset(profile.avatar.a) : Promise.resolve(null),
  ]);
  const st = storage.status === "fulfilled" ? storage.value : null;
  const al = albums.status === "fulfilled" ? albums.value.albums : null;
  const tk = tokens.status === "fulfilled" ? tokens.value.tokens : null;
  const photoUrl = photo.status === "fulfilled" && photo.value ? photo.value.thumbUrl : null;

  const stats: { k: string; v: string; hint?: string }[] = [
    { k: "Elementos", v: st ? st.count.toLocaleString("es-ES") : "—", hint: "fotos y vídeos" },
    { k: "Espacio usado", v: st ? bytesHuman(st.usedBytes) : "—", hint: "originales íntegros" },
    { k: "Álbumes", v: al ? al.length.toLocaleString("es-ES") : "—" },
    { k: "Tokens de subida", v: tk ? tk.length.toLocaleString("es-ES") : "—", hint: "Atajo de iOS" },
    { k: "Cuenta creada", v: fmt(DAY, user.created_at) },
    { k: "Último acceso", v: fmt(DAY_TIME, user.last_sign_in_at) },
  ];

  return (
    <div className="app">
      <div className="libhead">
        <div>
          <h2>
            Perfil
            <span className="lh-flourish" aria-hidden="true" />
          </h2>
          <p>Tu cuenta, tu avatar y cómo quieres que se comporte Upscale</p>
        </div>
      </div>

      <section className="panel pcard">
        <Avatar profile={profile} photoUrl={photoUrl} size={84} className="pcard-face" />
        <div className="pcard-meta">
          <h3>{profile.name || user.email?.split("@")[0] || "Tu cuenta"}</h3>
          <span className="pcard-mail">{profile.email}</span>
          {profile.bio && <p>{profile.bio}</p>}
          <div className="pchips">
            {providers.map((p) => (
              <span key={p} className="pchip">
                {PROVIDER_LABEL[p] ?? p}
              </span>
            ))}
            <span className="pchip">Miembro desde {fmt(DAY, user.created_at)}</span>
          </div>
        </div>
      </section>

      <div className="pstats" role="list">
        {stats.map((s) => (
          <div key={s.k} className="pstat" role="listitem">
            <span>{s.k}</span>
            <b>{s.v}</b>
            {s.hint && <small>{s.hint}</small>}
          </div>
        ))}
      </div>

      <section className="panel">
        <h3>Editar perfil</h3>
        <ProfileForm profile={profile} photoUrl={photoUrl} />
      </section>

      <section className="panel">
        <h3>Cuenta y seguridad</h3>
        <AccountSecurity email={profile.email} providers={providers} />
      </section>

      <section className="panel">
        <h3>Preferencias</h3>
        <p className="panel-lede">Se guardan en este dispositivo.</p>
        <Preferences />
      </section>

      {verTelegram && (
        <section className="panel">
          <h3>Conexiones</h3>
          <p className="panel-lede">
            Los vídeos que mandes «como archivo» a tus Mensajes guardados de Telegram entran en la cuenta que tengas atada.
          </p>
          <IngestBind />
        </section>
      )}

      <section className="panel">
        <h3>Más</h3>
        <p className="panel-lede">
          <Link href="/app/espacio">Espacio y plan</Link> · <Link href="/app/widgets">Widgets</Link> · <Link href="/app/ajustes">Ajustes</Link> ·{" "}
          <Link href="/app/ajustes#borrar">Borrar mi cuenta</Link> · <Link href="/privacidad">Privacidad</Link> ·{" "}
          <Link href="/terminos">Términos</Link>
        </p>
      </section>

      <section className="panel">
        <h3>Tus datos</h3>
        <ExportData
          snapshot={{
            email: profile.email,
            name: profile.name,
            bio: profile.bio,
            createdAt: user.created_at ?? null,
            lastSignInAt: user.last_sign_in_at ?? null,
            providers,
            items: st?.count ?? null,
            bytes: st?.usedBytes ?? null,
            albums: (al ?? []).map((a) => ({ name: a.name, count: a.count, createdAt: a.createdAt })),
          }}
        />
      </section>
    </div>
  );
}
