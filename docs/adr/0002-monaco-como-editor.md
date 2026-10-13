---
status: accepted
date: 2026-10-12
deciders: [usuario]
---

# 0002. Monaco como editor de código

## Context and Problem Statement

El cliente necesitará editor/visor de código (Fase 7). La referencia visual DocuMalia usa CodeMirror.

## Considered Options

- CodeMirror (el de DocuMalia)
- Monaco

## Decision Outcome

Elegida: **Monaco**, por preferencia explícita del usuario sobre CodeMirror. Carga diferida (lazy). Fuente: notas de `/bossdream-new` y `/bossdream-init`, 2026-10-12.

### Consequences

- Positiva: ninguna anclada; la justificación técnica no fue dada por el usuario.
- Negativa: puede requerir `style.vendorExempt` en el pipeline.
- Neutral: `monaco-editor` instalado en `package.json`; el uso real llega en la Fase 7.

## More Information

Ver `plans/fase-1-fundacion/design.md` §1.
