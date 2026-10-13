"use client";

import { useState } from "react";
import Link from "next/link";
import AuthButtons from "./AuthButtons";

/**
 * El registro, por pasos: primero UN solo botón. Solo al pulsarlo aparecen las
 * formas de entrar. Menos opciones a la vez = menos dudas = más gente que acaba.
 */
export default function StartBox({
  loggedIn,
  next,
  invited = false,
  label = "Empezar gratis",
}: {
  loggedIn: boolean;
  next: string;
  invited?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  if (loggedIn) {
    return (
      <div className="start">
        <Link className="btn primary start-btn" href={next}>
          Entrar a tu biblioteca
        </Link>
      </div>
    );
  }

  return (
    <div className="start">
      {open ? (
        <div className="start-open">
          <p className="start-q">¿Cómo quieres entrar?</p>
          <AuthButtons next={next} label="Seguir" />
          <button type="button" className="auth-switch" onClick={() => setOpen(false)}>
            ← Atrás
          </button>
        </div>
      ) : (
        <>
          <button type="button" className="btn primary start-btn" onClick={() => setOpen(true)}>
            {label}
          </button>
          <ul className="start-proof" aria-label="Lo que incluye">
            <li>5 GB gratis{invited ? " + 1 GB de regalo" : ""}</li>
            <li>Sin tarjeta</li>
            <li>1 minuto</li>
          </ul>
        </>
      )}
    </div>
  );
}
