import type { Metadata } from "next";
import { getStorage, listAssets, getAccount } from "@/lib/api";
import { bytesHuman } from "@/lib/format";
import SpaceManager from "@/components/SpaceManager";
import PlanPanel from "@/components/PlanPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Espacio y plan" };

export default async function EspacioPage() {
  let info: Awaited<ReturnType<typeof getStorage>> | null = null;
  let items: Awaited<ReturnType<typeof listAssets>>["items"] = [];
  const account = await getAccount();
  try {
    [info, { items }] = await Promise.all([getStorage(), listAssets({ limit: 200 })]);
  } catch {
    /* API caída */
  }

  const biggest = [...items].sort((a, b) => b.bytes - a.bytes).slice(0, 60);

  const usable = info?.diskTotalBytes ? Math.min(info.diskTotalBytes, (info.usedBytes ?? 0) + (info.diskFreeBytes ?? 0)) : null;
  const pct = usable ? Math.min(100, Math.round(((info?.usedBytes ?? 0) / usable) * 100)) : null;

  return (
    <div className="app">
      <div className="libhead">
        <h2>Espacio y plan</h2>
        <p>
          {info ? `${info.count.toLocaleString("es-ES")} elementos · ${bytesHuman(info.usedBytes)}` : "sin datos"}
          {info?.diskFreeBytes != null ? ` · ${bytesHuman(info.diskFreeBytes)} libres en disco` : ""}
        </p>
      </div>

      {account && <PlanPanel account={account} />}

      {!account && pct != null && (
        <div className="space-bar" aria-label={`${pct}% usado`}>
          <div className="space-bar-fill" style={{ width: `${pct}%` }} data-warn={pct >= 80} />
          <span>{pct}%</span>
        </div>
      )}

      {info?.driver === "local" && (
        <p className="panel-lede" style={{ marginTop: 12 }}>
          Los archivos viven en el disco del servidor. Cuando se acerque al 100 %, borra aquí lo
          más grande que ya tengas editado o descargado. Borrar es definitivo.
        </p>
      )}

      <SpaceManager biggest={biggest} />
    </div>
  );
}
