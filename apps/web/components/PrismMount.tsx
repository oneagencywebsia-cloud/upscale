import BrandMark from "./BrandMark";

/** El símbolo de la marca junto al título de la biblioteca (antes, una bola de luz). */
export default function PrismMount() {
  return (
    <div className="prism" aria-hidden="true">
      <BrandMark animated />
    </div>
  );
}
