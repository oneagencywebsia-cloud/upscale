"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  AVATAR_EMOJIS,
  AVATAR_GRADIENTS,
  BIO_MAX,
  NAME_MAX,
  gradientCss,
  initialsOf,
  type AvatarPref,
  type Profile,
} from "@/lib/profile";
import Avatar from "../Avatar";
import PhotoPicker from "./PhotoPicker";

type Tab = "gradient" | "emoji" | "photo";
const TABS: { key: Tab; label: string }[] = [
  { key: "gradient", label: "Color" },
  { key: "emoji", label: "Emoji" },
  { key: "photo", label: "Foto" },
];

/** Editar nombre, descripción y avatar. Se guarda en `user_metadata`. */
export default function ProfileForm({ profile, photoUrl }: { profile: Profile; photoUrl: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [avatar, setAvatar] = useState<AvatarPref>(profile.avatar);
  const [photo, setPhoto] = useState<string | null>(photoUrl);
  const [tab, setTab] = useState<Tab>(profile.avatar.style);
  const [picking, setPicking] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const dirty =
    name.trim() !== profile.name ||
    bio.trim() !== profile.bio ||
    avatar.style !== profile.avatar.style ||
    avatar.g !== profile.avatar.g ||
    (avatar.e ?? "") !== (profile.avatar.e ?? "") ||
    (avatar.a ?? "") !== (profile.avatar.a ?? "");

  const preview = { avatar, initials: initialsOf(name, profile.email) };

  function chooseTab(t: Tab) {
    setTab(t);
    if (t === "gradient") setAvatar((a) => ({ ...a, style: "gradient" }));
    if (t === "emoji") setAvatar((a) => ({ ...a, style: "emoji", e: a.e ?? AVATAR_EMOJIS[0] }));
    if (t === "photo" && avatar.a && photo) setAvatar((a) => ({ ...a, style: "photo" }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || status === "saving") return;
    setStatus("saving");
    // solo se guarda lo imprescindible (esto viaja dentro del token de sesión)
    const clean: AvatarPref = { style: avatar.style, g: avatar.g };
    if (avatar.style === "emoji" && avatar.e) clean.e = avatar.e;
    if (avatar.style === "photo" && avatar.a) clean.a = avatar.a;
    const { error } = await supabaseBrowser().auth.updateUser({
      data: { display_name: name.trim(), bio: bio.trim(), avatar: clean },
    });
    if (error) {
      setStatus("error");
      return;
    }
    setStatus("saved");
    router.refresh();
    window.setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2500);
  }

  return (
    <form className="pform" onSubmit={save}>
      <div className="pform-avatar">
        <Avatar profile={preview} photoUrl={photo} size={104} className="pform-face" />
        <div className="pform-avatar-tools">
          <div className="seg" role="group" aria-label="Tipo de avatar">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={tab === t.key ? "on" : ""}
                aria-pressed={tab === t.key}
                onClick={() => chooseTab(t.key)}
              >
                <span className="seg-label">{t.label}</span>
              </button>
            ))}
          </div>

          {(tab === "gradient" || tab === "emoji") && (
            <div className="swatches" role="group" aria-label="Color del avatar">
              {AVATAR_GRADIENTS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`swatch ${avatar.g === i ? "on" : ""}`}
                  style={{ background: gradientCss(i) }}
                  aria-label={`Color ${i + 1}`}
                  aria-pressed={avatar.g === i}
                  onClick={() => setAvatar((a) => ({ ...a, g: i }))}
                />
              ))}
            </div>
          )}

          {tab === "emoji" && (
            <div className="emojis" role="group" aria-label="Emoji del avatar">
              {AVATAR_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  className={avatar.e === em ? "on" : ""}
                  aria-pressed={avatar.e === em}
                  onClick={() => setAvatar((a) => ({ ...a, style: "emoji", e: em }))}
                >
                  {em}
                </button>
              ))}
            </div>
          )}

          {tab === "photo" && (
            <div className="pform-photo">
              <button type="button" className="btn sm" onClick={() => setPicking(true)}>
                {avatar.a ? "Cambiar foto" : "Elegir de mi biblioteca"}
              </button>
              <small>Usa una de tus fotos como avatar.</small>
            </div>
          )}
        </div>
      </div>

      <label className="pfield">
        <span>Nombre</span>
        <input
          value={name}
          maxLength={NAME_MAX}
          placeholder="Cómo quieres que te llamemos"
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="pfield">
        <span>
          Sobre ti <i>{bio.length}/{BIO_MAX}</i>
        </span>
        <textarea
          value={bio}
          maxLength={BIO_MAX}
          rows={3}
          placeholder="Una línea sobre ti o sobre esta biblioteca"
          onChange={(e) => setBio(e.target.value)}
        />
      </label>

      <div className="pform-actions">
        <button className="btn primary sm" type="submit" disabled={!dirty || status === "saving"}>
          {status === "saving" ? "Guardando…" : "Guardar cambios"}
        </button>
        {dirty && status !== "saving" && (
          <button
            className="btn ghost sm"
            type="button"
            onClick={() => {
              setName(profile.name);
              setBio(profile.bio);
              setAvatar(profile.avatar);
              setPhoto(photoUrl);
              setTab(profile.avatar.style);
            }}
          >
            Descartar
          </button>
        )}
        <span className="pstatus" role="status" aria-live="polite">
          {status === "saved" && "✓ Guardado"}
          {status === "error" && "No se pudo guardar. Inténtalo de nuevo."}
        </span>
      </div>

      {picking && (
        <PhotoPicker
          onClose={() => setPicking(false)}
          onPick={(a) => {
            setPhoto(a.thumbUrl);
            setAvatar((cur) => ({ ...cur, style: "photo", a: a.id }));
            setPicking(false);
          }}
        />
      )}
    </form>
  );
}
