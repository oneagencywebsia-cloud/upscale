/**
 * «De captura a nota editable»: la función que nadie espera. Todo CSS (solo
 * `transform`/`opacity`, ver `.demo` en globals.css): una línea de luz recorre la
 * captura y el texto aparece, línea a línea, en la nota de al lado.
 */
const LINEAS = ["Reunión jueves 10:30", "Llamar a Marta", "Comprar pan y leche", "Pasaporte: renovar en mayo"];

export default function Demo() {
  return (
    <div className="demo" aria-label="Ejemplo: una captura de pantalla se convierte en una nota con el texto editable">
      <div className="demo-shot" aria-hidden="true">
        <span className="demo-scan" />
        <div className="demo-phone">
          {LINEAS.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
        <small>Captura</small>
      </div>
      <span className="demo-arrow" aria-hidden="true">
        →
      </span>
      <div className="demo-note">
        <b>Nota</b>
        <ul>
          {LINEAS.map((l, i) => (
            <li key={l} style={{ ["--i" as string]: i }}>
              {l}
            </li>
          ))}
        </ul>
        <small>Texto listo para editar ✍️</small>
      </div>
    </div>
  );
}
