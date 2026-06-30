# PRD — Multi-target `steering add`

## Status
In Progress (implementado; pendiente validación del usuario — Gate 3)

## Problem
Hoy `steering add` instala el/los steering files en **un solo** agente por corrida:
el destino se resuelve a un único formato (`--agent <fmt>`, autodetección de un
único agente, o prompt de selección única). Un equipo que usa **más de un agente**
en el mismo workspace (p. ej. parte del equipo en Cursor y parte en Kiro, o un
monorepo consumido por varias herramientas) tiene que correr `add` una vez por
agente, recordando el `--agent` correcto cada vez. El converter standalone ya
soporta `--all-agents`, pero esa capacidad no existe en el flujo de instalación
gestionada (`add` + lock + `check`/`update`).

## Goals
- Instalar el mismo paquete de steering a **varios agentes** en una sola corrida.
- Que la autodetección, cuando hay **varios agentes presentes** en el workspace,
  permita elegir/instalar a **todos** ellos (no solo uno).
- Que `check`/`update`/`list`/`remove` funcionen correctamente cuando un mismo
  `name` está instalado en más de un formato.
- **Cero regresión** en el caso single-target actual (un agente → comportamiento y
  lock idénticos a hoy).

## Non-goals
- No se agrega un registry/website (sigue siendo el futuro `steering.sh`).
- No se cambia el modelo de conversión ni los formatos soportados (ya existen).
- No se soporta destino “mixto” por archivo (cada archivo a un agente distinto):
  el set de targets aplica a **todos** los archivos seleccionados de la corrida.

## User stories
- Como dev en un equipo multi-herramienta, quiero `steering add <repo> --agent cursor --agent kiro`
  para instalar el mismo contexto en ambos agentes de una vez.
- Como dev en un workspace con `.cursor/` y `.kiro/`, quiero que `add` (sin flags)
  me ofrezca instalar en **ambos** y, por default, lo haga en todos los detectados.
- Como dev, quiero `steering add <repo> --all-agents` para distribuir a todos los
  agentes que uso, sin listarlos uno por uno.
- Como dev, quiero que `steering check`/`update` detecten cambios para cada agente
  instalado, y que `steering remove security` lo saque de todos los agentes (o de
  uno, si lo acoto).

## Functional requirements

1. **FR-1 — `--agent` repetible.** `add` acepta `--agent <fmt>` múltiples veces; el
   conjunto de valores define los formatos destino. Validación: cada valor debe ser
   un `AgentFormat` válido.
2. **FR-2 — `--all-agents` / `--all-formats` en `add`.** `--all-agents` instala a
   todos los agentes **detectados** en el workspace (ver FR-4); si no se detecta
   ninguno, error con guía (pedir `--agent`). `--all-formats` fuerza los **8**
   formatos soportados (detectados o no). *(Decisión OQ1.)*
3. **FR-3 — Autodetección multi-target.** Cuando hay varios agentes presentes y no se
   pasó `--agent`/`--all-agents`:
   - En TTY: prompt **multiselect** con todos los detectados **premarcados**; instala
     a los elegidos.
   - No-TTY: instala a **todos** los detectados (con un mensaje informativo).
4. **FR-4 — Detección de presencia.** Reusa la detección por carpeta de agente
   (rules dir + carpeta padre; `.github` excluido) ya implementada.
5. **FR-5 — Instalación por target.** Para cada formato destino, cada archivo
   seleccionado se convierte (origen→formato) y se escribe en la ruta del formato,
   con sus warnings de degradación. Identidad (origen==destino) se escribe verbatim.
6. **FR-6 — Lock por (name, targetFormat).** El lock (local y global) debe poder
   registrar el **mismo `name` en múltiples formatos** sin colisión. El caso
   single-target conserva el shape actual (sin churn ni cambios visibles).
   *(Encoding exacto → PLAN; ver Open Question 4.)*
7. **FR-7 — `check`/`update` por par (name, formato).** Cada combinación instalada se
   verifica/actualiza de forma independiente, respetando el modelo D8 (global:
   short-circuit por hash de origen; workspace: reconvertir y comparar).
8. **FR-8 — `list` por target.** Lista cada `name` una vez por formato instalado,
   mostrando `[formato]` y el `source`.
9. **FR-9 — `remove`.** `remove <name>` elimina el `name` de **todos** los formatos
   donde esté instalado (con confirmación). `--agent <fmt>` acota a un formato.
   *(Ver Open Question 3.)*
10. **FR-10 — `--dry-run`.** Muestra, por cada target, qué archivos se instalarían y
    sus warnings, sin escribir.
11. **FR-11 — Resumen.** Al finalizar, reporta cuántos archivos se instalaron y a qué
    agentes (p. ej. “Installed 4 files across 2 agents (cursor, kiro)”).
12. **FR-12 — Back-compat.** Un único target (un `--agent`, o un solo agente
    detectado) produce exactamente el comportamiento y el lock actuales.

## Non-functional requirements
- **Sin nuevas dependencias.** Reusar converter, installer, locks existentes.
- **Determinismo** de serializadores intacto (necesario para workspace `check`).
- **Merge-friendliness** del lock local: el caso single-target kiro→kiro sigue sin
  hash ni campos de formato; el esquema multi-target no debe introducir churn en
  entradas single-target preexistentes.
- **TS estricto**, ESM, imports `.ts`, estilo del repo.

## Data model changes
Afecta los lock files (no hay base de datos). Hoy ambos locks mapean
`steering: Record<name, Entry>` — un `name` ⇒ una entrada. Multi-target requiere
representar **(name, targetFormat) ⇒ entrada**. El encoding concreto se define en el
PLAN; la restricción es: (a) soportar el mismo `name` en varios formatos; (b) no
romper la lectura de locks existentes (local v1, global v4); (c) preservar el shape
single-target actual. Ver `PLAN.md` y Open Question 4.

## UI/UX notes
- Prompt multiselect de agentes (cuando varios presentes y sin flags), premarcando
  todos los detectados.
- Salida por target agrupada (encabezado por agente), reaprovechando el estilo de
  `convert --all-agents` ya existente.
- Mensajes de scope (`workspace`/`global`) por agente.

## Resolved decisions
1. **OQ1 — `--all-agents` = detectados.** `--all-agents` instala a los agentes
   detectados; un flag aparte `--all-formats` fuerza los 8 formatos.
2. **OQ2 — no-TTY con varios detectados → instala a todos los detectados** (mensaje
   informativo, sin fallar).
3. **OQ3 — `remove <name>` borra de todos los formatos** con confirmación; `--agent`
   acota a uno.
4. **OQ4 — Lock con clave compuesta `name@formato`**, conservando `name` pelado
   cuando hay un único formato (back-compat total con locks single-target v1; sin
   churn). Lectores toleran ambas formas.
5. **(Informativa)** No hay colisión de archivos en disco (cada formato en su
   carpeta); la única colisión era en la clave del lock, resuelta por OQ4.

## Conflicts / dependencies
- **Depende** de la feature ya entregada (converter + `add --agent` single-target,
  locks v4/v1, detección por carpeta) documentada en
  `docs/prds/000-initial/PRD-converter.md`, `docs/prds/000-initial/PLAN.md` y
  `LIMITATIONS.md` (raíz del repo).
- **Toca** `add.ts` (selección de targets, loop por target), los lock files y sus
  lectores en `update.ts`/`list.ts`/`remove.ts`, y el help de `cli.ts`.
- **Reusa** `convert --all-agents` como referencia de UX (no se modifica).
- Sin conflicto con el `PRD.md` raíz (el caso single-target queda intacto).
