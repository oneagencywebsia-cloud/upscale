"use client";

import { useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { Mesh } from "three";

function Crystal() {
  const mesh = useRef<Mesh>(null);
  const { pointer } = useThree();
  const reduce =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useFrame((_, dt) => {
    if (!mesh.current) return;
    if (!reduce) {
      mesh.current.rotation.y += dt * 0.25;
      mesh.current.rotation.x += dt * 0.08;
    }
    mesh.current.rotation.z += (pointer.x * 0.25 - mesh.current.rotation.z) * 0.05;
  });

  return (
    <mesh ref={mesh} scale={1.35}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#7adcec" flatShading roughness={0.18} metalness={0.55} />
    </mesh>
  );
}

/** Cristal 3D girando lentamente — acento decorativo. Va dentro de un ErrorBoundary. */
export default function PrismAccent() {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 4.2], fov: 45 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      style={{ width: "100%", height: "100%" }}
    >
      <ambientLight intensity={0.6} />
      <pointLight position={[3, 2, 4]} intensity={40} color="#ffd68c" />
      <pointLight position={[-4, -1, 2]} intensity={30} color="#5ac8e8" />
      <Crystal />
    </Canvas>
  );
}
