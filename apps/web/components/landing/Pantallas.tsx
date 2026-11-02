import type { CSSProperties } from "react";

/**
 * Lo que enseña la pantalla del móvil en cada capítulo: la app de verdad (interfaz de Upscale), dibujada
 * con HTML/CSS —sin imágenes que cargar ni fotos de nadie—. Las «fotos» son degradados de luz (`.ft-N`).
 * Todo está en `em`: se escala solo con el tamaño del móvil. Las animaciones de cada pantalla arrancan
 * cuando se ve (`.mv-s[data-on="1"]`), así no cuesta nada mientras está oculta.
 */
const Ft = ({ n, d = 0, className = "" }: { n: number; d?: number; className?: string }) => (
  <i className={`ft ft-${n}${className ? ` ${className}` : ""}`} style={{ ["--d" as string]: d } as CSSProperties} />
);
const Barra = () => (
  <div className="mv-barra">
    <b>9:41</b>
    <span><i /><i /><i /></span>
  </div>
);
const Mosaico = ({ n = 11, desde = 0 }: { n?: number; desde?: number }) => (
  <div className="mv-grid">
    {Array.from({ length: n }, (_, i) => (
      <Ft key={i} n={((i + desde) % 8) + 1} d={i} />
    ))}
  </div>
);
const Tic = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

export function pantallasA() {
  return [
    // 0 · tus recuerdos
    <div key="a0" className="mv-ui">
      <Barra />
      <div className="mv-tit"><b>Tu biblioteca</b><small>Todo a salvo</small></div>
      <Mosaico />
    </div>,
    // 1 · se rompe
    <div key="a1" className="mv-ui mv-roto">
      <Barra />
      <div className="mv-aviso">Almacenamiento lleno</div>
      <div className="mv-tit"><b>Tu biblioteca</b></div>
      <Mosaico n={9} desde={2} />
      <svg className="mv-grieta" viewBox="0 0 100 200" preserveAspectRatio="none" aria-hidden="true">
        <path pathLength="1" d="M62 34 L50 66 L54 94 L32 138 L24 200" />
        <path pathLength="1" d="M62 34 L80 62 L74 98 L92 150 L98 200" />
        <path pathLength="1" d="M54 94 L74 108 L100 104" />
        <path pathLength="1" d="M50 66 L28 60 L0 70" />
        <path pathLength="1" d="M32 138 L10 150 L0 170" />
      </svg>
    </div>,
    // 2 · un toque
    <div key="a2" className="mv-ui">
      <Barra />
      <div className="mv-tit"><b>Guardando…</b><small>Fotos, vídeos y música</small></div>
      {[3, 6, 1].map((n, i) => (
        <div key={i} className="mv-fila" style={{ ["--d" as string]: i } as CSSProperties}>
          <Ft n={n} />
          <div><b>{["IMG_1474", "Vacaciones", "Cumpleaños"][i]}</b><em><u /></em></div>
        </div>
      ))}
      <div className="mv-ok"><span><Tic /></span><b>A salvo</b></div>
    </div>,
    // 3 · calidad original
    <div key="a3" className="mv-ui">
      <Barra />
      <Ft n={5} className="mv-grande" />
      <div className="mv-chips"><span>Original</span><span>4K</span><span>60 fps</span><span>HEVC</span></div>
      <div className="mv-linea"><span><Tic /></span>Tal como lo grabaste</div>
    </div>,
  ];
}

export function pantallasB({ regalo, invitado }: { regalo: string; invitado: string }) {
  return [
    // 0 · en todas partes
    <div key="b0" className="mv-ui">
      <Barra />
      <div className="mv-tit"><b>Mi biblioteca</b><small>Al día en todos tus aparatos</small></div>
      <div className="mv-sync"><span style={{ ["--d" as string]: 0 } as CSSProperties}>Móvil</span><span style={{ ["--d" as string]: 1 } as CSSProperties}>Tableta</span><span style={{ ["--d" as string]: 2 } as CSSProperties}>Ordenador</span></div>
      <Mosaico n={8} desde={3} />
    </div>,
    // 1 · privado
    <div key="b1" className="mv-ui mv-centro">
      <Barra />
      <div className="mv-candado">
        <i /><i />
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.6" /><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" /></svg>
      </div>
      <b className="mv-gran">Solo tuyo</b>
      <ul className="mv-lista">
        <li><span><Tic /></span>Nadie más lo ve</li>
        <li><span><Tic /></span>Te lo llevas cuando quieras</li>
        <li><span><Tic /></span>Borras tu cuenta cuando quieras</li>
      </ul>
    </div>,
    // 2 · legado
    <div key="b2" className="mv-ui">
      <Barra />
      <div className="mv-tit"><b>Familia</b><small>Cuatro generaciones</small></div>
      <div className="mv-avs"><i>A</i><i>M</i><i>L</i><i>+</i></div>
      <div className="mv-anios"><span>1998</span><span>2008</span><span>2018</span><span className="on">Hoy</span></div>
      <Mosaico n={8} desde={5} />
    </div>,
    // 3 · regala espacio
    <div key="b3" className="mv-ui mv-centro">
      <Barra />
      <b className="mv-gran">Regala espacio</b>
      <div className="mv-regalo">
        <div style={{ ["--d" as string]: 0 } as CSSProperties}><b>+{regalo}</b><small>para ti</small></div>
        <div style={{ ["--d" as string]: 1 } as CSSProperties}><b>+{invitado}</b><small>para tu amigo</small></div>
      </div>
      <div className="mv-boton">Copiar mi enlace</div>
    </div>,
  ];
}

export function pantallasC() {
  return [
    // 0 · piénsalo
    <div key="c0" className="mv-ui">
      <Barra />
      <div className="mv-tit"><b>Un día como hoy</b><small>Hace veinte años</small></div>
      <div className="mv-recuerdo"><Ft n={2} className="mv-grande" /><span>Ese verano</span></div>
      <Mosaico n={4} desde={4} />
    </div>,
    // 1 · empieza
    <div key="c1" className="mv-ui mv-centro">
      <Barra />
      <div className="mv-mas"><i /><i /><span>+</span></div>
      <b className="mv-gran">Tu primer recuerdo</b>
      <small className="mv-peq">Elige una foto. El resto, ya lo hacemos nosotros.</small>
    </div>,
  ];
}
