"use client";

import dynamic from "next/dynamic";
import ErrorBoundary from "./ErrorBoundary";

const PrismAccent = dynamic(() => import("./PrismAccent"), { ssr: false });

/** Monta el cristal 3D solo en cliente. Si WebGL falla, muestra un orbe CSS. */
export default function PrismMount() {
  return (
    <div className="prism" aria-hidden="true">
      <ErrorBoundary fallback={<div className="prism-fallback" />}>
        <PrismAccent />
      </ErrorBoundary>
    </div>
  );
}
