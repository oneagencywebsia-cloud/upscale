"use client";

import { Component, type ReactNode } from "react";

/** Si los hijos revientan (p.ej. WebGL no disponible), renderiza `fallback` y no tira la página. */
export default class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    /* silencioso: es decorativo */
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
