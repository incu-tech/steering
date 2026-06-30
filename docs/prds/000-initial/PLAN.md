# PLAN — Universal Agent Rule Converter integrado en `steering`

> Plan de implementación derivado de `PRD-converter.md`, desambiguado y ajustado
> al estado real del repo (`@incu/steering` ya implementado) y a las
> políticas de `CLAUDE.md`. **Este documento es solo el plan; no hay código aún.**

---

## 0. Decisiones tomadas (resuelven ambigüedades del PRD)

| # | Tema | Decisión | Implicancia |
|---|------|----------|-------------|
| D1 | **Empaquetado** | Un **solo paquete** (`@incu/steering`). El converter vive en `src/convert/`, se exporta como librería y se expone como subcomando `steering convert`. No hay repo/monorepo aparte. | Reutiliza tsconfig/build/vitest/`frontmatter.ts`/`types.ts` existentes. |
| D2 | **Caso de uso central** | `steering add` **detecta el formato de origen** de lo descargado y **reformatea al formato destino** antes de instalar. La conversión deja de ser opcional: es parte del pipeline de `add`. | Toca discovery, resolve, installer, add, locks, update, list, remove. |
| D3 | **Parser de frontmatter** | **Reusar el parser YAML seguro** (`src/frontmatter.ts`, basado en `yaml`). **NO** añadir `gray-matter` (RCE por eval; prohibido por CLAUDE.md). El PRD §10 se corrige en este punto. | Serializar con `yaml.stringify` (key order estable). |
| D4 | **Alcance v1** | **Todo**: módulo + CLI standalone (`steering-convert`) + subcomando (`steering convert`) + integración en `steering add --agent`. | Entrega grande; ver orden de implementación §10. |
| D5 | **AGENTS.md multi-sección** | **Implementar split por H2**: cada `##` genera un `CanonicalRule` independiente al convertir a formatos multi-archivo. | Requiere spec de slug/colisiones/tracking en lock (§7). |
| D6 | **Formato destino en `add`** | **Auto-detect del workspace** (`.kiro/`, `.cursor/`, `.claude/`, `.windsurf/`, `.github/instructions/`, `.opencode/`, `.clinerules/`, `AGENTS.md`) **+ `--agent <fmt>` override**. Varios presentes → prompt. Nada presente → `kiro` (back-compat). | Nueva lógica de resolución de scope/destino en `add`. |
| D7 | **Formato de origen en `add`** | **Auto-detect por archivo/carpeta** sobre lo descargado (cualquier formato soportado). `--from <fmt>` como override ante ambigüedad. | Discovery deja de asumir Kiro. |
| D8 | **check/update con conversión** | **Lock global**: ya guarda el SHA del *origen*; solo se añade `targetFormat` (+ `sourceFormat`). **Lock local (hashless, por CLAUDE.md)**: guardar solo campos **estables** (`sourceFormat`, `targetFormat`); `check` re-descarga origen → convierte → compara contra el archivo instalado. Cero churn de merge. | Serializadores deben ser **byte-deterministas**. |

---

## 1. Modelo canónico y reutilización de tipos

El modelo canónico del PRD §3 **coincide** con el `InclusionMode` ya definido en
`src/types.ts` (mismos 4 modos: `always | fileMatch | manual | auto`). Reutilizamos
ese tipo en vez de duplicarlo.

```ts
// src/convert/types.ts (NUEVO)
import type { InclusionMode } from '../types.ts'; // reuse

export type AgentFormat =
  | 'kiro' | 'claude-code' | 'cursor' | 'windsurf'
  | 'copilot' | 'opencode' | 'agents-md' | 'cline';

export interface CanonicalRule {
  name: string;               // nombre de archivo sin extensión
  inclusion: InclusionMode;   // reuse
  filePatterns?: string[];    // para fileMatch
  description?: string;       // para auto
  body: string;               // markdown sin frontmatter
}

export interface ConversionWarning {
  type: 'degraded_inclusion' | 'patterns_truncated' | 'unsupported_mode' | 'empty_body';
  message: string;
  originalValue: string;
  appliedFallback: string;
}

export interface ConversionResult {
  sourcePath: string;
  outputPath: string;
  targetFormat: AgentFormat;
  warnings: ConversionWarning[];
}
```

**Relación con `SteeringFile`** (tipo existente): `SteeringFile` es el objeto
"listo para instalar" del pipeline de `add`. Pasa a apoyarse en `CanonicalRule`
(un `SteeringFile` se construye desde un `CanonicalRule` + el contenido serializado
al `targetFormat`). Se añaden a `SteeringFile` los campos `sourceFormat` y
`targetFormat`. Detalle en §6.

---

## 2. Mapa de formatos (referencia de implementación)

| Formato | Dir / archivo | Ext | Frontmatter clave | Inclusión |
|---|---|---|---|---|
| `kiro` | `.kiro/steering/` | `.md` | `inclusion`, `fileMatchPattern`, `description` | nativo (4 modos) |
| `claude-code` | `.claude/rules/` | `.md` | `paths: []` | sin `paths`=always; con=fileMatch |
| `cursor` | `.cursor/rules/` | `.mdc` | `alwaysApply`, `globs`, `description` | 4 modos derivados |
| `windsurf` | `.windsurf/rules/` | `.md` | igual a cursor | igual a cursor |
| `copilot` | `.github/instructions/` | `.instructions.md` | `applyTo` (string) | sin=always; con=fileMatch |
| `opencode` | `.opencode/rules/` | `.md` | `paths: []` | igual a claude-code |
| `agents-md` | raíz | `AGENTS.md` | — | always (flat, split por H2) |
| `cline` | `.clinerules/` | `.md` | — | always |

---

## 3. Arquitectura de archivos nuevos (`src/convert/`)

```
src/convert/
├── types.ts            # CanonicalRule, AgentFormat, ConversionResult, ConversionWarning
├── formats.ts          # tabla por formato: dir, ext, filename, capacidades de inclusión
├── detect.ts           # detectFormat(path|content|dir) → AgentFormat
├── parse/
│   ├── index.ts        # parseRule(path) → CanonicalRule (dispatch por formato)
│   ├── kiro.ts
│   ├── claude-code.ts  # también opencode (mismo shape `paths`)
│   ├── cursor.ts       # también windsurf (mismo shape)
│   ├── copilot.ts
│   ├── agents-md.ts    # split por H2 (D5)
│   └── cline.ts
├── serialize/
│   ├── index.ts        # serializeRule(rule, fmt) → string (determinista)
│   ├── kiro.ts
│   ├── claude-code.ts  # + opencode
│   ├── cursor.ts       # + windsurf
│   ├── copilot.ts
│   ├── agents-md.ts
│   └── cline.ts
├── degradation.ts      # tabla §4 del PRD → warnings
├── output-paths.ts     # resuelve dir + filename + ext por formato destino
└── convert.ts          # convert() / convertDirectory(): parse → serialize + escribe
```

`src/index.ts` (NUEVO en raíz de `src/`): re-exporta la API pública de la librería
(`convert`, `convertDirectory`, `parseRule`, `serializeRule`, `detectFormat`, tipos).
Se añade `"exports"` en `package.json` para el import como módulo (`@incu/steering`).

---

## 4. Tabla de conversión + degradación (`degradation.ts`)

Implementa la matriz del PRD §4 y §4.1. Reglas:

- **always** → todos: directo (sin warning).
- **fileMatch** → kiro/claude-code/cursor/windsurf/copilot/opencode: directo.
  - → `copilot`: `applyTo` acepta **un** string. Si hay >1 patrón, usar el primero
    + warning `patterns_truncated` listando los descartados.
  - → agents-md/cline: incluir contenido + comentario al inicio con el patrón original
    (warning informativo, sin pérdida de contenido).
- **manual** → claude-code/copilot: degrada a always sin `paths`/`applyTo` + warning
  `unsupported_mode`. → cursor/windsurf: sin frontmatter (= manual). → agents-md/cline: N/A.
- **auto** → claude-code/copilot: degrada a always + warning. → cursor/windsurf:
  `description` + `alwaysApply:false` sin globs. → agents-md/cline: N/A.

Mensajes exactos según PRD §4.1 (p. ej. `"manual mode not supported in Claude Code — installed as always"`).

**`formats.ts`** declara las capacidades de cada formato (qué modos soporta nativamente)
para que `degradation.ts` sea data-driven, no un switch gigante.

---

## 5. Parsers y serializers (notas críticas)

### Parsers (`parse/*`)
- Reusan `parseFrontmatter` de `src/frontmatter.ts` (seguro, sin gray-matter).
- Casos edge (PRD §8): sin frontmatter → `always`; `globs:""` → `always`;
  `alwaysApply:true` + globs → `always` (prioridad de `alwaysApply`); body vacío →
  warning `empty_body` pero se genera el archivo.
- `cursor`: derivar los 4 modos de la combinación `alwaysApply`/`globs`/`description`.
- `agents-md`: **split por H2** (ver §7).

### Serializers (`serialize/*`) — DETERMINISMO OBLIGATORIO (D8)
Para que `check` (re-convertir y comparar) funcione y los round-trips sean estables:
- Orden de claves YAML fijo por formato (no depender del orden de inserción).
- Quoting y line endings consistentes (`\n`, sin trailing whitespace variable).
- `yaml.stringify` con opciones explícitas; un helper compartido garantiza salida byte-estable.

---

## 6. Cambios en módulos EXISTENTES (impacto del scope D2/D4)

### `src/types.ts`
- Añadir `sourceFormat?: AgentFormat` y `targetFormat?: AgentFormat` a `SteeringFile`.
- `AGENTS` de un solo agente (kiro) se mantiene para defaults, pero `AgentFormat`
  pasa a ser el enum canónico de destinos.

### `src/constants.ts`
- Añadir, por formato, su directorio workspace, directorio global, extensión y patrón
  de filename. (Hoy solo existen las rutas Kiro). Fuente de verdad: `convert/formats.ts`
  (constants re-exporta o delega para no duplicar).

### `src/steering.ts` (discovery) — **deja de ser Kiro-specific**
- `toSteeringFile` hoy llama `validateKiroFrontmatter` y asume Kiro. Cambiar a:
  `detectFormat(repoPath/content)` → `parseRule` → `CanonicalRule` (+ `sourceFormat`).
  Las warnings de frontmatter se generalizan o se mantienen solo para kiro.
- La precedencia de descubrimiento (manifest → `steering/` → root) se conserva,
  pero ahora puede descubrir archivos en cualquier formato.

### `src/resolve.ts`
- `ResolvedSource.files` ahora trae `CanonicalRule`+`sourceFormat`. La conversión al
  destino ocurre en `add` (cuando ya se conoce el `targetFormat`), no en discovery.
- Soportar `--from <fmt>` (override de detección) propagado desde `add`.

### `src/installer.ts` → introducir `output-paths`
- Hoy asume **un dir plano + `<name>.md`**. Generalizar:
  - `getTargetDir(format, global, cwd)` y `getInstalledPath(format, name, global, cwd)`
    usan dir/ext/filename del formato (`.mdc` para cursor, `.github/instructions/<name>.instructions.md` para copilot, etc.).
  - `sanitizeName` se mantiene; la extensión deja de hardcodearse a `.md`.
  - `listInstalledNames` debe escanear el dir correcto por formato (de ahí que el lock
    guarde `targetFormat`).

### `src/add.ts`
- `AddOptions`: añadir `agent?: AgentFormat` (`--agent`) y `from?: AgentFormat` (`--from`).
- Nueva resolución de **destino** (D6): auto-detect de dirs presentes; varios → prompt;
  `--agent` fuerza; ninguno → kiro.
- Pipeline por archivo: `CanonicalRule` (origen) → `convert` a `targetFormat` → escribir
  con `output-paths` → registrar en lock con `sourceFormat`/`targetFormat`.
- Surface de warnings de degradación además de las de frontmatter.
- `--dry-run` muestra origen→destino + ruta resultante + warnings.

### `src/steering-lock.ts` (global) — D8
- Añadir `targetFormat: AgentFormat` y `sourceFormat: AgentFormat` a `SteeringLockEntry`.
- `steeringFileHash` se mantiene = **SHA del origen** (ya es conversion-safe).
- Bump de versión del lock global (v3 → v4) con fallback de lectura.

### `src/local-lock.ts` (workspace, hashless) — D8
- Añadir solo campos **estables**: `sourceFormat`, `targetFormat`. **Sin** `sourceSha`.
- Mantener v1 si el shape es retrocompatible (campos opcionales); si no, v2 con fallback.
- Para entradas nativas kiro→kiro, `targetFormat` puede omitirse (default kiro) para
  preservar al máximo la amigabilidad de merge.

### `src/update.ts` — D8
- `collectItems`/`checkItems` deben usar `targetFormat`/`sourceFormat` del lock.
- **Global**: comparar SHA del origen (igual que hoy) — ya funciona; al actualizar,
  re-descargar origen → `convert` a `targetFormat` → escribir.
- **Workspace (hashless + reconvertir)**: `check` re-descarga origen → `parseRule` →
  `convert(targetFormat)` → comparar (byte) contra el archivo instalado leído de su
  ruta por-formato. `update` reescribe el resultado convertido.
- `getInstalledPath` debe recibir el `targetFormat` correcto (hoy asume kiro/`.md`).

### `src/list.ts` y `src/remove.ts`
- Escanear/operar sobre el dir+ext correcto por `targetFormat` (leído del lock).
- `remove` de un origen AGENTS.md con split (D5) debe borrar **todos** los archivos
  derivados (ver §7).

### `src/cli.ts`
- Nuevo subcomando `convert <source> --to <fmt> [--from] [--out] [--dry-run] [--force] [--warn-only] [--all-agents]`.
- `add`: documentar `--agent` y `--from` en el help.
- (Opcional) bin adicional `steering-convert` en `package.json` apuntando al mismo CLI
  con el comando `convert` implícito, para `npx steering-convert ...`.

---

## 7. Spec de split por H2 de AGENTS.md (D5)

- **Parse** (`parse/agents-md.ts`):
  - Si el archivo tiene secciones `##` (H2): cada sección → un `CanonicalRule`
    (`inclusion: always`), `name` = slug del título H2 (`sanitizeName`).
  - Contenido antes del primer H2 (preámbulo): si es no-trivial, se emite como regla
    `index`/`agents` o se prepend a la primera sección (decisión de implementación;
    documentar la elegida). Si no hay H2 → un único `CanonicalRule` `always` con todo el body.
- **Colisiones de slug**: sufijo `-2`, `-3`… y warning.
- **Serialize → AGENTS.md** (varias reglas → un archivo): concatenar como secciones H2,
  con comentario de patrón original para reglas `fileMatch` (degradación §4).
- **Tracking en lock**: una entrada de origen AGENTS.md puede mapear a N archivos
  instalados. El lock debe registrar la lista de `name` derivados (o N entradas que
  compartan `source`+`steeringFilePath`) para que `remove`/`update` los traten en bloque.
  Decisión: **N entradas** con un campo `originGroup` opcional = path del AGENTS.md origen.

---

## 8. Auto-detección de formato (`detect.ts`) — PRD §7

Orden de señales:
1. **Path/dir**: `.kiro/steering/`→kiro, `.claude/rules/`→claude-code, `.cursor/rules/`→cursor, etc.
2. **Extensión**: `.mdc`→cursor; `.instructions.md`→copilot.
3. **Frontmatter**: `inclusion:`→kiro; `paths:`→claude-code/opencode (ambiguo→prompt o `--from`);
   `applyTo:`→copilot; `globs:`+`alwaysApply:`→cursor/windsurf.
4. **Filename**: `AGENTS.md`→agents-md; (legacy `.cursorrules`/`.windsurfrules` solo detect).
- Ambigüedad (p. ej. `paths:` claude-code vs opencode): pedir confirmación o exigir `--from`.

---

## 9. Tests

- **Unit** (`src/convert/*.test.ts`, excluyendo `skills/` como ya hace vitest.config):
  - `parse.test.ts`, `serialize.test.ts`, `detect.test.ts`, `degradation.test.ts`,
    `output-paths.test.ts`, `convert.test.ts`.
  - Fixtures por formato en `tests/fixtures/<format>/`.
- **Determinismo**: test que serializa el mismo `CanonicalRule` dos veces y exige bytes idénticos.
- **Acceptance (PRD §12)** — implementar los 7:
  1. Round-trip kiro→claude-code→kiro: comparar por **igualdad del modelo canónico**,
     no byte-a-byte (clave para no fallar por reformateo legítimo).
  2. fileMatch kiro→cursor: `globs:"**/*.java"` + `alwaysApply:false`.
  3. Degradación manual→claude-code: archivo sin `paths` + warning + no falla.
  4. Múltiples paths→copilot: `applyTo` primer patrón + warning del descartado.
  5. AGENTS.md→kiro: split por H2 (D5) o bloque único si no hay H2.
  6. Auto-detección de `--from`.
  7. `--dry-run` no escribe nada.
- **Integración add con conversión**: kiro→cursor instalado en `.cursor/rules/*.mdc`;
  check/update workspace hashless (reconvertir y comparar).

---

## 10. Orden de implementación

Sigue el PRD §11 pero intercalando la integración (D4):

1. `convert/types.ts` + `convert/formats.ts` (tabla de capacidades/paths por formato).
2. `parse/kiro.ts` + test (reusa frontmatter seguro).
3. `parse/claude-code.ts` (+opencode), `parse/cursor.ts` (+windsurf) + tests.
4. `serialize/{kiro,claude-code,cursor}.ts` + tests + **test de determinismo**.
5. `degradation.ts` + test (matriz §4).
6. `detect.ts` + test.
7. `output-paths.ts` + test.
8. `convert.ts` (+ `convertDirectory`) + test.
9. Resto parsers/serializers: windsurf, copilot, opencode, agents-md (split H2), cline.
10. `src/index.ts` (API pública) + `package.json` `exports`.
11. CLI: subcomando `steering convert` + bin `steering-convert`.
12. **Integración**: `steering.ts`/`resolve.ts` (discovery format-agnostic) →
    `installer.ts`/output-paths → `add.ts` (`--agent`/`--from`, auto-detect destino) →
    locks (global +`targetFormat`, local +`sourceFormat`/`targetFormat`) →
    `update.ts` (global re-convert / workspace reconvertir-y-comparar) → `list.ts`/`remove.ts`.
13. Tests de integración end-to-end + acceptance §12.

**Tras cada bloque de código nuevo en TS (lenguaje soportado por Snyk): correr `snyk_code_scan` y remediar antes de seguir** (política CLAUDE.md global).

---

## 11. Dependencias

- **NO** `gray-matter` (D3). Reusar `yaml` (ya presente).
- `micromatch`: solo si necesitamos validar globs estrictamente. **Propuesta: omitir en v1**
  (los globs se transportan como strings; no los validamos semánticamente). Confirmar si
  se quiere validación real.
- `picocolors`, `@clack/prompts`: ya presentes.

---

## 12. Riesgos / decisiones abiertas (no bloquean el plan)

- **R1 — Determinismo de serializadores**: imprescindible para workspace check (D8) y
  round-trips. Mitigación: helper de YAML con orden de claves fijo + test de bytes.
- **R2 — Ambigüedad claude-code vs opencode** (mismo `paths:`): se resuelve con `--from`
  o prompt; documentar el default.
- **R3 — Preámbulo de AGENTS.md** antes del primer H2: decidir destino (regla `index`
  vs prepend). Documentar.
- **R4 — `micromatch`**: incluir o no validación de globs (ver §11).
- **R5 — Compat de locks**: bump global v3→v4; local intentar retrocompat con campos
  opcionales. Verificar lectura de locks viejos sin romper.
- **R6 — `--all-agents` en `add` vs en `convert`**: en `convert` standalone tiene sentido
  (escribir a todos los dirs). En `add` el destino es uno (o prompt). Mantener `--all-agents`
  solo en el subcomando `convert`.
