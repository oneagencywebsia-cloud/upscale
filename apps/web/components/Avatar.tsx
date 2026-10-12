import { gradientCss, type Profile } from "@/lib/profile";

/** Avatar del usuario: foto de su biblioteca, emoji o iniciales sobre degradado. */
export default function Avatar({
  profile,
  photoUrl,
  size = 38,
  className = "",
}: {
  profile: Pick<Profile, "avatar" | "initials">;
  /** miniatura ya resuelta de la foto elegida (si style = photo) */
  photoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const { avatar, initials } = profile;
  const usePhoto = avatar.style === "photo" && !!photoUrl;
  return (
    <span
      className={`avatar-face ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: usePhoto ? "var(--surface-2)" : gradientCss(avatar.g),
      }}
      aria-hidden="true"
    >
      {usePhoto ? (
        <img src={photoUrl!} alt="" draggable={false} />
      ) : avatar.style === "emoji" && avatar.e ? (
        <span style={{ fontSize: Math.round(size * 0.52), lineHeight: 1 }}>{avatar.e}</span>
      ) : (
        initials
      )}
    </span>
  );
}
