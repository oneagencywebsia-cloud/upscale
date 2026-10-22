import Mark3D from "./Mark3D";

/** El símbolo de la marca junto al título de la biblioteca (antes, una bola de luz). */
export default function PrismMount() {
  return (
    <div className="prism" aria-hidden="true">
      <Mark3D size={88} />
    </div>
  );
}
