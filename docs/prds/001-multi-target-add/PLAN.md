# Implementation Plan — Multi-target `steering add`

Plan para `docs/prds/001-multi-target-add/PRD.md`. Convenciones del repo:
**npm + vitest** (no pnpm), TS estricto, ESM, imports `.ts`. Gates del flujo
`incu-way-development`.

## Branch
- Rama: `feat/multi-target-add` (in-place, base `main`).

## Diseño clave

### 1. Resolución de targets (reemplaza el single-target actual)
`AddOptions` cambia `agent?: AgentFormat` → `agents: AgentFormat[]`, y suma
`allAgents: boolean`, `allFormats: boolean`. `parseAddOptions`:
- `--agent <fmt>` ahora es **repetible** → push a `agents` (validando cada valor).
- `--all-agents` → `allAgents = true`.
- `--all-formats` → `allFormats = true`.

Nueva función `resolveTargetFormats(options, present, cwd): Promise<AgentFormat[]>`
(reemplaza `resolveTargetFormat`):
1. `options.agents.length > 0` → esos (dedup, preservando orden).
2. `options.allFormats` → `AGENT_FORMATS` (los 8).
3. `options.allAgents` → `present`; si vacío → `fail(...)` pidiendo `--agent`.
4. Auto (sin flags):
   - `present.length === 0` → `['kiro']` (back-compat).
   - `present.length === 1` → `present`.
   - `present.length > 1`:
     - TTY → `p.multiselect` con todos los `present` **premarcados** (`initialValues`).
     - no-TTY → `present` (todos los detectados) + mensaje informativo.

`resolveScope` (global vs workspace) **no cambia**: aplica igual a todos los targets.

### 2. Loop de instalación por target
`runAdd`: tras `selected` y `targets`, iterar `for (const targetFormat of targets)`:
- reusar `planInstall(selected, targetFormat)` (sin cambios) → `units`/`docs`.
- escribir cada doc con `writeRuleFile(targetFormat, …)`.
- registrar lock por `(doc.name, targetFormat)` (ver §3).
- acumular para el resumen: total archivos + set de agentes.
- `--dry-run`: imprimir por target qué se instalaría (encabezado por agente), sin escribir.
- Resumen final: `Installed N files across M agents (a, b)`.

### 3. Esquema de claves del lock (OQ4) — clave compuesta con back-compat
Hoy ambos locks: `steering: Record<key, Entry>` con `key === name`. Para soportar el
mismo `name` en varios formatos sin colisión:
- **Invariante:** un `name` con **un solo** formato instalado → clave **pelada**
  `name`; con **>1** formato → claves `name@<formato>` por cada uno.
- Las entradas siempre llevan `name` y (salvo el caso kiro→kiro minimal del lock
  local) `targetFormat`. **Los lectores no parsean la clave**: usan `entry.name` y
  `entry.targetFormat ?? 'kiro'`. La clave solo garantiza unicidad.

Nuevo módulo `src/lock-keys.ts` (genérico sobre `{ name; targetFormat? }`):
- `keysForName(steering, name): string[]` → claves `=== name` o `startsWith(name+'@')`.
- `upsertByFormat(steering, name, format, entry)`:
  1. juntar entradas existentes de `name` (por sus claves) en un `Map<format, Entry>`;
  2. `map.set(format, entry)` (alta o reemplazo del mismo formato);
  3. borrar las claves viejas de `name`;
  4. re-escribir: `composite = map.size > 1`; clave = `composite ? name@fmt : name`.
  - Maneja 1→1 (pelada), 1→2 (re-keya ambas a compuestas), 2→2, y replace.
- `removeByName(steering, name, format?): Entry[]`:
  - borra todas las entradas de `name` (si `format` undefined) o solo la de ese
    formato; **re-normaliza** las restantes (si queda una sola → vuelve a clave pelada);
  - devuelve las entradas borradas (para que el caller borre los archivos en disco).

### 4. Cambios en los locks
- `local-lock.ts`:
  - `addToLocalLock(entry, cwd)` → `upsertByFormat(lock.steering, entry.name, entry.targetFormat ?? 'kiro', entry)`.
  - `removeFromLocalLock(name, cwd, format?)` → `removeByName(...)`, devuelve nº borradas.
- `steering-lock.ts`:
  - `addToGlobalLock(entry)` → preservar `installedAt` buscando la entrada existente
    de `(name, format)` entre `keysForName`; luego `upsertByFormat`.
  - `removeFromGlobalLock(name, format?)` → `removeByName`.

### 5. Lectores (usar `entry.name`, no la clave)
- `update.ts` `collectItems`: cambiar `for (const [name, entry] of Object.entries(...))`
  a usar `entry.name` como `item.name` (la clave puede ser compuesta). El resto (D8)
  no cambia: cada item es ya un par (name, formato) vía `entry.targetFormat`.
- `list.ts`: ya usa `Object.values().map(e => e.name)` → OK; aparece una línea por
  `(name, formato)`.
- `remove.ts`: reescribir para agrupar por `entry.name`:
  - construir `Map<name, {format, …}[]>` desde el lock del scope.
  - selección interactiva muestra **nombres únicos**.
  - por cada name objetivo: `removeByName(steering, name, options.agent)` (si
    `--agent` → solo ese formato; si no → todos); por cada entrada borrada, `unlink`
    del archivo en `getInstalledPath(name, global, cwd, entry.targetFormat)`.
  - `--agent <fmt>` se agrega a `RemoveOptions`.

### 6. CLI / help
- `cli.ts`: documentar en `add options:` que `--agent` es repetible y agregar
  `--all-agents` / `--all-formats`.

## Phases

### Phase A — Lock keying core
- [ ] `src/lock-keys.ts`: `keysForName`, `upsertByFormat`, `removeByName` (+ unit tests).

### Phase B — Locks usan el keying
- [ ] `local-lock.ts`: `addToLocalLock` / `removeFromLocalLock(name, cwd, format?)`.
- [ ] `steering-lock.ts`: `addToGlobalLock` (preserva `installedAt`) / `removeFromGlobalLock(name, format?)`.

### Phase C — `add` multi-target
- [ ] `add.ts`: `AddOptions` (`agents[]`, `allAgents`, `allFormats`), `parseAddOptions`
      (`--agent` repetible, `--all-agents`, `--all-formats`), `resolveTargetFormats`,
      loop por target, resumen, `--dry-run` por target.

### Phase D — Lectores y CLI
- [ ] `update.ts`: `collectItems` usa `entry.name`.
- [ ] `remove.ts`: agrupar por name, `--agent`, borrar por formato.
- [ ] `list.ts`: verificar salida por (name, formato) (probable sin cambios).
- [ ] `cli.ts`: help.

### Phase E — Tests + validación
- [ ] Tests nuevos/actualizados (ver Test plan).
- [ ] `pnpm type-check`, `pnpm test`, `pnpm build`.
- [ ] Snyk (MCP si está disponible; si no, CLI `snyk code test src/`) — sin issues
      nuevos introducidos por la feature.

## Test plan
- **Unit `lock-keys`:** 1→1 pelada; 1→2 re-keya a compuestas; replace mismo formato;
  `removeByName` all vs por-formato + re-normalización a pelada.
- **`add` integración:**
  - `--agent cursor --agent kiro` → archivos en `.cursor/rules` y `.kiro/steering`;
    lock con claves `security@cursor` + `security@kiro`.
  - single `--agent cursor` → clave pelada `security` (back-compat; no churn).
  - autodetección con `.cursor/` + `.kiro/` en no-TTY → instala a ambos.
  - `--all-formats` (dry-run) → lista los 8 targets.
- **`remove`:** `remove security` (multi) borra de ambos formatos y limpia lock;
  `remove security --agent kiro` borra solo kiro y re-normaliza la clave restante a pelada.
- **`check`/`update`:** un name en 2 formatos → 2 items independientes; mutar la fuente
  marca update en ambos; `update` reconvierte cada uno.
- **Back-compat:** leer un lock v1 single-target existente (clave pelada) sigue
  funcionando en list/check/remove.
- **No regresión:** suite actual (84 tests) verde.

## Rollback notes
- Feature aislada en `feat/multi-target-add`. Revertir = `git checkout main` y borrar
  la rama; o `git revert` de los commits.
- **Compat de datos:** el esquema de lock es retrocompatible (clave pelada para
  single-target; lectores toleran ambas). Un lock escrito por esta feature en modo
  single-target es idéntico al actual; en modo multi-target, volver a la versión
  anterior dejaría entradas `name@fmt` que el lector viejo trataría como nombres
  literales (degradación benigna: `list` mostraría `security@cursor`). Documentar.
