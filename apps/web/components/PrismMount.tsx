"use client";

import dynamic from "next/dynamic";
import ErrorBoundary from "./ErrorBoundary";

const PrismAccent = dynamic(() => import("./PrismAccent"), { ssr: false });

/** Monta el cristal 3D solo en cliente y con red de seguridad. */
export default function PrismMount() {
  return (
    <div className="prism" aria-hidden="true">
      <ErrorBoundary>
        <PrismAccent />
      </ErrorBoundary>
    </div>
  );
}
