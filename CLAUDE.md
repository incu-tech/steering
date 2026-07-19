# CLAUDE.md — `steering` CLI

Guía breve para trabajar en este repo.

## Qué es

CLI (distribuida vía `npx`) que gestiona **steering files de agentes de IA** igual
que `npx skills` gestiona Agent Skills: empaquetar, instalar, actualizar y eliminar
archivos de contexto desde repos Git (públicos y privados).

Publicada en npm bajo tres nombres (misma tool):
- **`@incu/steering`** — paquete canónico (toda la lógica + librería).
- **`steering.sh`** y **`steering-cli`** — alias finos en `aliases/` que dependen de
  `@incu/steering` y solo corren su CLI (`import '@incu/steering/cli'`). Una sola
  fuente de verdad; heredan patches por rango semver.

Inspirado en [`vercel-labs/skills`](https://github.com/vercel-labs/skills) (MIT).

## Formatos soportados

`kiro` (canónico), `claude-code`, `cursor`, `windsurf`, `copilot`, `opencode`,
`agents-md`, `cline`. Un archivo se autora una vez y se instala/convierte al formato
nativo de cada agente. El subsistema de conversión vive en `src/convert/` (Kiro es el
pivote por ser el formato más expresivo). Sin `--agent`, `add` autodetecta el/los
target(s) del workspace y cae a Kiro.

## Layout

- `src/` — código fuente (TS estricto, ESM, imports con extensión `.ts`).
- `src/convert/` — parsers/serializers por formato + detección.
- `bin/` — entrypoints: `steering` → `cli.mjs`, `steering-convert` → `convert.mjs`.
- `aliases/` — paquetes alias `steering.sh` y `steering-cli`.
- `tests/` y `src/**/*.test.ts` — Vitest.

## Stack

- **Runtime:** Node ≥18. **Package manager:** pnpm (ver `pnpm-workspace.yaml`).
- **Build:** `obuild` → `dist/`. **Test:** Vitest. **Format:** Prettier.
- **Deps de runtime:** `yaml`, `picocolors`, `@clack/prompts`. El frontmatter usa un
  parser propio basado en `yaml` (no `gray-matter`, que tiene RCE por `eval`).

```bash
pnpm install
pnpm test          # vitest
pnpm type-check    # tsc --noEmit
pnpm build         # obuild → dist/
```

## Conceptos clave (no obvios del código)

- **Rutas de instalación:** cada formato instala en su propio dir (Kiro →
  `.kiro/steering/<name>.md`). Global con `-g`.
- **Lock files:**
  - Local (workspace): `steering-lock.json`, **mínimo** (sin hashes/timestamps) para
    evitar conflictos de merge; la detección de cambios recomputa el blob SHA del
    archivo en disco.
  - Global: `~/.steering/steering-lock.json` (dir neutral, no bajo el home de un agente).
- **Detección de cambios:** git blob SHA. Para GitHub se lee del tree de la API; para
  local/clonado se computa con `computeGitBlobSha()`. `check`/`update` comparan ese SHA.
- **Auth (GitHub):** lazy. Repos **públicos funcionan sin token**; el token solo se
  busca ante 401/403/rate-limit. Orden: `GITHUB_TOKEN` → `GH_TOKEN` → `gh auth token`.
  `gh` no es obligatorio.
- **Frontmatter Kiro:** `inclusion: always | fileMatch | manual | auto`. Validación
  **advisory** (warn, nunca bloquea la instalación).

## `steering.json` (manifest del paquete fuente)

```json
{
  "name": "incu-standards",
  "version": "1.0.0",
  "steering": [
    { "name": "security", "description": "...", "file": "steering/security.md" }
  ]
}
```

Descubrimiento de un repo fuente, en orden: `steering.json` → `.md` en `steering/`
→ `.md` en la raíz.

## Convenciones

- Tras generar código nuevo, correr `snyk_code_scan` y remediar antes de seguir.
