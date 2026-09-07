"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";

const PALETTES: [string, string][] = [
  ["#0f2027", "#2c5364"], ["#ff9966", "#7a2a4f"], ["#4b6cb7", "#182848"],
  ["#f8ffae", "#43c6ac"], ["#c94b4b", "#4b134f"], ["#2193b0", "#6dd5ed"],
  ["#005c97", "#363795"], ["#ffe259", "#ffa751"], ["#3a1c71", "#ffaf7b"],
  ["#134e5e", "#71b280"], ["#e0eafc", "#cfdef3"], ["#f857a6", "#ff5858"],
];

function gradientTexture([a, b]: [string, string]) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function PhotoCloud() {
  const group = useRef<THREE.Group>(null);
  const planes = useMemo(() => {
    return Array.from({ length: 34 }, (_, i) => {
      const r = 3.2 + Math.random() * 4.5;
      const theta = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * 6;
      return {
        pos: new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r - 2),
        rot: (Math.random() - 0.5) * 0.8,
        scale: 0.7 + Math.random() * 1.3,
        tex: gradientTexture(PALETTES[i % PALETTES.length]!),
        speed: 0.15 + Math.random() * 0.25,
      };
    });
  }, []);

  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.06;
  });

  return (
    <group ref={group}>
      {planes.map((p, i) => (
        <Float key={i} speed={p.speed} rotationIntensity={0.4} floatIntensity={0.7}>
          <mesh position={p.pos} rotation={[0, p.rot, p.rot * 0.5]} scale={p.scale}>
            <planeGeometry args={[1.5, 1.9]} />
            <meshBasicMaterial map={p.tex} toneMapped={false} transparent opacity={0.92} side={THREE.DoubleSide} />
          </mesh>
        </Float>
      ))}
    </group>
  );
}

function Rig() {
  const { camera, pointer } = useThree();
  useFrame(() => {
    camera.position.x += (pointer.x * 1.6 - camera.position.x) * 0.04;
    camera.position.y += (pointer.y * 1.0 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, -2);
  });
  return null;
}

export default function HeroScene() {
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return (
    <Canvas
      className="hero-canvas"
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 9], fov: 50 }}
      gl={{ antialias: true, alpha: true }}
      frameloop={reduce ? "demand" : "always"}
    >
      <color attach="fog" args={["#0a0d14"]} />
      <fog attach="fog" args={["#0a0d14", 9, 20]} />
      <ambientLight intensity={1.2} />
      <PhotoCloud />
      {!reduce && <Rig />}
      <EffectComposer>
        <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.2} luminanceSmoothing={0.3} />
        <Vignette eskil={false} offset={0.3} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  );
}
