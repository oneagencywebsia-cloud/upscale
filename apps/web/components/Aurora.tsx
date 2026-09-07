"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/** Fondo WebGL animado (aurora de shader) para la app. Barato y a pantalla completa. */
const frag = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uRes;
  varying vec2 vUv;

  vec3 palette(float t){
    vec3 a = vec3(0.05,0.06,0.09);
    vec3 b = vec3(0.10,0.30,0.42);
    vec3 c = vec3(0.31,0.77,0.86);
    vec3 d = vec3(0.55,0.44,1.00);
    return a + b*0.5*sin(6.2831*(c*t + d));
  }
  float noise(vec2 p){
    return sin(p.x*1.7 + uTime*0.15) * cos(p.y*1.3 - uTime*0.1)
         + 0.5*sin(p.x*3.1 - uTime*0.07) * cos(p.y*2.3 + uTime*0.12);
  }
  void main(){
    vec2 uv = vUv;
    vec2 p = (uv - 0.5) * vec2(uRes.x/uRes.y, 1.0) * 2.2;
    float n = noise(p) + 0.4*noise(p*2.0 + 3.0);
    float glow = smoothstep(1.6, -0.2, length(p) - n*0.35);
    vec3 col = palette(0.15 + 0.12*n + uTime*0.01);
    col = mix(vec3(0.039,0.051,0.078), col, clamp(glow*0.9, 0.0, 1.0));
    // viñeta hacia arriba
    col *= 0.85 + 0.35*(1.0 - uv.y);
    gl_FragColor = vec4(col, 1.0);
  }
`;
const vert = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }
`;

function Plane() {
  const mat = useRef<THREE.ShaderMaterial>(null);
  useFrame((state) => {
    if (mat.current) {
      mat.current.uniforms.uTime.value = state.clock.elapsedTime;
      mat.current.uniforms.uRes.value.set(state.size.width, state.size.height);
    }
  });
  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={mat}
        fragmentShader={frag}
        vertexShader={vert}
        uniforms={{ uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } }}
      />
    </mesh>
  );
}

export default function Aurora() {
  const reduce =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return (
    <div className="aurora-gl" aria-hidden="true">
      <Canvas dpr={[1, 1.5]} gl={{ antialias: false }} frameloop={reduce ? "demand" : "always"} orthographic>
        <Plane />
      </Canvas>
    </div>
  );
}
