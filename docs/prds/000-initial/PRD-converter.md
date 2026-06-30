# PRD: Universal Agent Rule Converter

**Version:** 0.1.0-draft  
**Status:** Ready for implementation  
**Owner:** Incu  
**Target consumer:** Claude Code (agentic implementation)  
**Repo sugerido:** `steering-convert` o como módulo `@incu/steering-convert`

---

## 1. Problema

Cada agente de AI coding tiene su propio formato de archivo para definir reglas/contexto persistente. El contenido es semánticamente idéntico, pero el formato difiere: distintos nombres de campo en el frontmatter, distintas ubicaciones en el filesystem, y distintas extensiones de archivo.

Hoy no existe una herramienta que:

1. Entienda **todos** los formatos incluyendo Kiro steering files
2. Convierta de cualquiera a cualquiera con fidelidad semántica
3. Funcione como CLI standalone **y** como módulo importable (para integrarse en el `steering` CLI del PRD principal)

`rule-porter` (existente, open source) convierte entre Cursor, Windsurf, CLAUDE.md, AGENTS.md y Copilot, pero no soporta Kiro ni funciona como librería. Este PRD especifica un reemplazo/complemento que cubre el gap.

---

## 2. Formatos soportados

### 2.1 Mapa completo de formatos

| Agente | Archivo / directorio | Frontmatter | Inclusión condicional |
|--------|---------------------|-------------|----------------------|
| **Kiro** | `.kiro/steering/*.md` | `inclusion`, `fileMatchPattern` | `always` / `fileMatch` / `manual` / `auto` |
| **Claude Code** | `.claude/rules/*.md` | `paths` (array de globs) | Sin `paths` = always; con `paths` = fileMatch |
| **Cursor** | `.cursor/rules/*.mdc` | `alwaysApply`, `globs`, `description` | `alwaysApply:true` / globs / description-only / sin todo |
| **Windsurf** | `.windsurf/rules/*.md` | igual a Cursor | igual a Cursor |
| **Copilot** | `.github/instructions/*.instructions.md` | `applyTo` (glob string) | Sin `applyTo` = always; con `applyTo` = fileMatch |
| **OpenCode** | `.opencode/rules/*.md` | `paths` (array de globs) | Igual a Claude Code |
| **AGENTS.md** | `AGENTS.md` (raíz) | sin frontmatter | always (archivo único, flat) |
| **Cline** | `.clinerules/*.md` | sin frontmatter | always (todos se combinan) |

### 2.2 Referencia de frontmatter por agente

#### Kiro
```yaml
---
inclusion: always | fileMatch | manual | auto
fileMatchPattern: "**/*.java"        # solo cuando inclusion: fileMatch
description: "descripción semántica" # solo cuando inclusion: auto
---
```

#### Claude Code / OpenCode
```yaml
---
paths:
  - "src/**/*.ts"
  - "**/*.test.ts"
---
# sin paths = always
```

#### Cursor / Windsurf
```yaml
---
description: "descripción para agent-decided"
globs: "src/**/*.ts"       # string o array
alwaysApply: true | false
---
# alwaysApply:true = always
# alwaysApply:false + globs = fileMatch
# alwaysApply:false + description (sin globs) = auto/agent-decided
# sin nada = manual
```

#### GitHub Copilot
```yaml
---
applyTo: "**/*.tsx"    # glob string; sin campo = always
---
```

#### AGENTS.md / Cline
```
# sin frontmatter — always, archivo plano
```

---

## 3. Modelo semántico canónico

El converter trabaja con un modelo interno canónico que captura la semántica de todos los formatos. La conversión es: `formato_origen → canónico → formato_destino`.

```typescript
interface CanonicalRule {
  // Identidad
  name: string                    // nombre del archivo sin extensión

  // Modo de inclusión
  inclusion: InclusionMode

  // Para fileMatch
  filePatterns?: string[]         // array de glob patterns

  // Para auto/agent-decided
  description?: string

  // Contenido
  body: string                    // contenido markdown sin frontmatter
}

type InclusionMode =
  | "always"      // siempre activo
  | "fileMatch"   // activo cuando se trabaja con archivos matching
  | "manual"      // activación explícita por el usuario
  | "auto"        // el agente decide basado en description
```

---

## 4. Tabla de conversión de modos de inclusión

Esta es la tabla crítica. Define qué pasa con cada modo cuando se convierte a otro formato.

| Canónico → | Kiro | Claude Code | Cursor | Windsurf | Copilot | AGENTS.md | Cline |
|---|---|---|---|---|---|---|---|
| **always** | `inclusion: always` | sin `paths` | `alwaysApply: true` | `alwaysApply: true` | sin `applyTo` | contenido agregado | archivo .md |
| **fileMatch** | `inclusion: fileMatch` + `fileMatchPattern` | `paths: [...]` | `globs: "..."` + `alwaysApply: false` | `globs: "..."` + `alwaysApply: false` | `applyTo: "..."` | ⚠️ con comentario | archivo .md + comentario |
| **manual** | `inclusion: manual` | ⚠️ sin paths (degraded) | sin frontmatter | sin frontmatter | ⚠️ sin applyTo (degraded) | N/A | N/A |
| **auto** | `inclusion: auto` | ⚠️ sin paths (degraded) | `description:` + sin globs + `alwaysApply: false` | `description:` + sin globs + `alwaysApply: false` | ⚠️ sin applyTo (degraded) | N/A | N/A |

**⚠️ Degraded:** el formato destino no tiene equivalente exacto. El converter debe emitir un warning y documentar el comportamiento de fallback.

### 4.1 Reglas de degradación

Cuando hay pérdida semántica inevitable:

- `manual` → Claude Code: se instala sin `paths` (se convierte en `always`). Warning: `"manual mode not supported in Claude Code — installed as always"`
- `auto` → Copilot: se instala sin `applyTo` (se convierte en `always`). Warning: `"auto mode not supported in Copilot — installed as always"`
- `fileMatch` → AGENTS.md/Cline: se incluye el contenido con un comentario al inicio del bloque indicando el patrón original. No hay pérdida de contenido, solo de la condición de activación.
- Múltiples `filePatterns` → Cursor/Windsurf: Cursor soporta `globs` como array o string. Si es array, se usa array. Sin pérdida.
- Múltiples `filePatterns` → Copilot: `applyTo` acepta solo un string. Se toma el primer patrón y se emite warning con los patrones descartados.

---

## 5. Especificación de la CLI

### 5.1 Comando principal

```bash
npx steering-convert <source> --to <format> [options]
```

O como parte del steering CLI principal:

```bash
npx steering convert <source> --to <format> [options]
```

### 5.2 Argumentos y opciones

| Argumento/Flag | Descripción |
|---|---|
| `<source>` | Archivo a convertir, directorio, o glob (ej: `.kiro/steering/*.md`) |
| `--to <format>` | Formato destino. Valores: `kiro`, `claude-code`, `cursor`, `windsurf`, `copilot`, `opencode`, `agents-md`, `cline` |
| `--from <format>` | Formato origen (auto-detectado si se omite) |
| `--out <path>` | Directorio o archivo de salida. Default: directorio estándar del agente destino en el proyecto actual |
| `--dry-run` | Muestra qué se escribiría sin escribir nada |
| `--force` | Sobreescribe archivos existentes sin preguntar |
| `--warn-only` | No falla en degradaciones, solo emite warnings |
| `--all-agents` | Convierte a todos los formatos soportados simultáneamente |

### 5.3 Ejemplos

```bash
# Convertir todos los steering files de Kiro a Claude Code
npx steering-convert .kiro/steering/ --to claude-code

# Archivo específico, destino específico
npx steering-convert .kiro/steering/security.md --to cursor --out .cursor/rules/

# Ver qué haría sin ejecutar
npx steering-convert .kiro/steering/ --to claude-code --dry-run

# Convertir a todos los agentes de una vez
npx steering-convert .kiro/steering/security.md --all-agents

# Desde Claude Code rules hacia Kiro
npx steering-convert .claude/rules/ --to kiro

# Desde Cursor hacia todos
npx steering-convert .cursor/rules/ --to kiro --out .kiro/steering/
npx steering-convert .cursor/rules/ --to claude-code
```

### 5.4 Output de consola

```
Converting .kiro/steering/ → Claude Code (.claude/rules/)

  security.md          always    →  .claude/rules/security.md         ✓
  architecture.md      always    →  .claude/rules/architecture.md     ✓
  java-conventions.md  fileMatch →  .claude/rules/java-conventions.md ✓  [paths: **/*.java]
  incident-response.md manual    →  .claude/rules/incident-response.md ⚠ [degraded: manual→always]

3 files converted, 1 warning.

Warnings:
  incident-response.md: 'manual' mode has no equivalent in Claude Code.
  File installed as 'always'. To keep manual behavior, reference it
  explicitly in CLAUDE.md with @.claude/rules/incident-response.md
```

---

## 6. API como módulo (para integración con steering CLI)

El converter se exporta como módulo TypeScript con una API limpia para que el `steering` CLI lo consuma internamente.

```typescript
import { convert, detectFormat, parseRule, serializeRule } from '@incu/steering-convert'

// Convertir un archivo
const result = await convert({
  source: '.kiro/steering/security.md',
  targetFormat: 'claude-code',
  outputDir: '.claude/rules/'
})

// result.warnings contiene degradaciones
// result.outputPath es donde se escribió

// Convertir un directorio completo
const results = await convertDirectory({
  sourceDir: '.kiro/steering/',
  targetFormat: 'cursor',
  outputDir: '.cursor/rules/'
})

// Auto-detectar formato de un archivo
const format = await detectFormat('.kiro/steering/security.md')
// → 'kiro'

// Parsear un archivo a modelo canónico (sin escribir nada)
const rule = await parseRule('.cursor/rules/api.mdc')
// → CanonicalRule { name: 'api', inclusion: 'fileMatch', filePatterns: ['src/api/**'], body: '...' }

// Serializar modelo canónico a string de un formato dado
const output = serializeRule(rule, 'claude-code')
// → '---\npaths:\n  - "src/api/**"\n---\n...'
```

### 6.1 Tipos exportados

```typescript
export type AgentFormat =
  | 'kiro'
  | 'claude-code'
  | 'cursor'
  | 'windsurf'
  | 'copilot'
  | 'opencode'
  | 'agents-md'
  | 'cline'

export interface CanonicalRule {
  name: string
  inclusion: 'always' | 'fileMatch' | 'manual' | 'auto'
  filePatterns?: string[]
  description?: string
  body: string
}

export interface ConversionResult {
  sourcePath: string
  outputPath: string
  targetFormat: AgentFormat
  warnings: ConversionWarning[]
}

export interface ConversionWarning {
  type: 'degraded_inclusion' | 'patterns_truncated' | 'unsupported_mode'
  message: string
  originalValue: string
  appliedFallback: string
}
```

---

## 7. Auto-detección de formato

El comando `--from` es opcional porque el formato se auto-detecta por:

1. **Path/directorio:** `.kiro/steering/` → kiro, `.claude/rules/` → claude-code, etc.
2. **Extensión:** `.mdc` → cursor (único que usa esta extensión)
3. **Frontmatter:** si tiene `inclusion:` → kiro; `paths:` → claude-code/opencode; `applyTo:` → copilot; `globs:` + `alwaysApply:` → cursor/windsurf
4. **Filename:** `AGENTS.md` → agents-md; `.windsurfrules` → windsurf legacy; `.cursorrules` → cursor legacy

Si la detección es ambigua (ej: un `.md` suelto con `paths:` podría ser claude-code u opencode), se pide confirmación al usuario, o se puede especificar `--from` explícitamente.

---

## 8. Casos edge y comportamiento esperado

| Caso | Comportamiento |
|---|---|
| Archivo sin frontmatter | Se interpreta como `inclusion: always` |
| `globs: ""` (Cursor vacío) | Se trata como `always` |
| `alwaysApply: true` + `globs` presentes | `alwaysApply` tiene prioridad → `always` |
| Múltiples `filePatterns` → Copilot | Se usa el primer patrón, warning por los descartados |
| `AGENTS.md` como origen | Se parsea como un único bloque `always`; si tiene múltiples secciones H2, se genera un archivo por sección al convertir a formatos que admiten múltiples archivos |
| Archivo destino ya existe | Prompt interactivo para sobreescribir, a menos que `--force` o `--dry-run` |
| Cuerpo vacío | Warning + archivo generado de todas formas (el usuario puede tener intención de llenarlo) |

---

## 9. Estructura del proyecto

```
steering-convert/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # exports públicos de la librería
│   ├── cli.ts                # entry point CLI
│   ├── detect.ts             # auto-detección de formato
│   ├── parse.ts              # parsers por formato → CanonicalRule
│   │   ├── kiro.ts
│   │   ├── claude-code.ts
│   │   ├── cursor.ts
│   │   ├── windsurf.ts
│   │   ├── copilot.ts
│   │   ├── opencode.ts
│   │   ├── agents-md.ts
│   │   └── cline.ts
│   ├── serialize.ts          # serializers por formato: CanonicalRule → string
│   │   ├── kiro.ts
│   │   ├── claude-code.ts
│   │   ├── cursor.ts
│   │   ├── windsurf.ts
│   │   ├── copilot.ts
│   │   ├── opencode.ts
│   │   ├── agents-md.ts
│   │   └── cline.ts
│   ├── convert.ts            # orquesta parse → serialize + escribe archivos
│   ├── degradation.ts        # lógica de warnings por pérdida semántica
│   ├── output-paths.ts       # resuelve directorio/nombre de archivo destino
│   └── types.ts              # CanonicalRule, AgentFormat, etc.
└── tests/
    ├── parse.test.ts
    ├── serialize.test.ts
    ├── convert.test.ts
    ├── detect.test.ts
    └── fixtures/             # archivos de ejemplo por formato para tests
        ├── kiro/
        ├── claude-code/
        ├── cursor/
        └── ...
```

---

## 10. Dependencias

| Dep | Uso |
|-----|-----|
| `gray-matter` | Parseo de YAML frontmatter en todos los formatos |
| `micromatch` | Validación de glob patterns |
| `picocolors` | Output de consola con color |
| `@clack/prompts` | Prompts interactivos (sobreescribir, confirmar) |

Sin dependencias de runtime pesadas. El parser/serializer es lógica pura TypeScript sobre `gray-matter`.

---

## 11. Orden de implementación para Claude Code

1. **`types.ts`** — definir `CanonicalRule`, `AgentFormat`, `ConversionResult`, `ConversionWarning`
2. **`parse/kiro.ts`** + test con fixtures — el formato más rico semánticamente, buen punto de partida
3. **`parse/claude-code.ts`** + test
4. **`parse/cursor.ts`** + test (incluye los 4 modos de Cursor)
5. **`serialize/kiro.ts`**, **`serialize/claude-code.ts`**, **`serialize/cursor.ts`** + tests
6. **`degradation.ts`** — tabla de pérdida semántica + mensajes de warning
7. **`detect.ts`** — auto-detección de formato
8. **`output-paths.ts`** — resolución de paths de salida por formato
9. **`convert.ts`** — orquestación completa
10. **Resto de parsers/serializers**: windsurf, copilot, opencode, agents-md, cline
11. **`cli.ts`** — entry point con @clack/prompts
12. **Tests de integración** end-to-end: kiro→claude-code, cursor→kiro, claude-code→all

---

## 12. Acceptance tests (criterios de "done")

### Test 1 — Round-trip sin pérdida
```
kiro/security.md (always) → claude-code → kiro
```
El archivo resultante debe ser semánticamente idéntico al original.

### Test 2 — fileMatch preservado
```
kiro/java-conventions.md (fileMatch: **/*.java) → cursor
```
El archivo Cursor resultante debe tener `globs: "**/*.java"` y `alwaysApply: false`.

### Test 3 — Degradación con warning
```
kiro/incident-response.md (manual) → claude-code
```
Debe: (a) generar el archivo sin `paths`, (b) emitir warning de degradación, (c) no fallar.

### Test 4 — Múltiples patrones
```
claude-code/api.md (paths: ["src/api/**/*.ts", "src/api/**/*.test.ts"]) → copilot
```
Debe: (a) usar `applyTo: "src/api/**/*.ts"` (primer patrón), (b) emitir warning por el segundo patrón descartado.

### Test 5 — AGENTS.md origen
```
AGENTS.md (sin frontmatter) → kiro
```
Debe generar un único `always` steering file con el contenido completo.

### Test 6 — Auto-detección
```
steering-convert .kiro/steering/security.md --to cursor
```
Debe auto-detectar `--from kiro` sin que el usuario lo especifique.

### Test 7 — Dry run
```
steering-convert .kiro/steering/ --to claude-code --dry-run
```
No debe escribir ningún archivo. Solo imprime qué haría.

---

## 13. Relación con el steering CLI (PRD principal)

Este módulo es una dependencia interna del `steering` CLI. Cuando el usuario corre:

```bash
npx steering add incu/kiro-steering --agent claude-code
```

El `steering` CLI descarga los archivos fuente (que están en formato Kiro) y llama internamente a `steering-convert` para instalarlos en `.claude/rules/` con el formato correcto.

```
steering add
    ↓
descarga .md de GitHub (formato Kiro)
    ↓
steering-convert: kiro → claude-code
    ↓
escribe en .claude/rules/
```

El converter también es útil standalone para equipos que ya tienen steering files en un formato y quieren migrarse a otro agente, sin usar el steering CLI de distribución.

---

## Apéndice A: Comparación con rule-porter (existente)

`rule-porter` (github.com/nedcodes-ok/rule-porter) es el proyecto existente más cercano:

| | rule-porter | steering-convert |
|---|---|---|
| Kiro support | ❌ | ✅ |
| OpenCode support | ❌ | ✅ |
| API como librería | ❌ (solo CLI) | ✅ |
| Modelo canónico explícito | ❌ (conversión directa) | ✅ |
| Warnings de degradación | ❌ | ✅ |
| Integración con steering CLI | N/A | ✅ nativa |
| TypeScript types exportados | ❌ | ✅ |

Si `rule-porter` agrega soporte de Kiro y expone una API, vale evaluar contribuir a ese repo en vez de mantener uno propio.
