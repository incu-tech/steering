# PRD — Steering files desde cualquier repo Git (no solo GitHub)

## Status
Draft (propuesta — sin implementar)

## Problem
Hoy `steering add` solo instala desde **GitHub** (vía la API REST `api.github.com`)
o desde una **ruta local**. El parser de fuentes (`source-parser.ts`) ya reconoce
GitLab y URLs git genéricas (devuelve `type: 'gitlab' | 'git' | 'well-known'`),
pero la resolución (`resolveSource` en `resolve.ts`) las **rechaza** con un mensaje
de "no instalable todavía".

Esto deja afuera a equipos que alojan su contexto de IA en **GitLab, Bitbucket,
Azure DevOps, Gitea o un Git self-hosted** (caso común en enterprise / banca, que
es justamente el público objetivo). También obliga a depender de `GITHUB_TOKEN` /
`gh` para repos privados, cuando esos equipos ya tienen su `git` autenticado por
SSH o credential helper.

## Goals
- `steering add <fuente>` instala steering files desde **cualquier remoto Git**
  accesible por el `git` del usuario: GitHub, GitLab, Bitbucket, Azure DevOps,
  Gitea, self-hosted, vía HTTPS o SSH.
- Reusar la **autenticación git existente** (SSH keys / credential helper / `.netrc`)
  para repos privados — sin requerir `GITHUB_TOKEN` ni `gh`.
- `check` / `update` funcionan para estas fuentes con el **mismo modelo de detección
  de cambios** (git blob SHA), de forma host-agnóstica.
- **Cero regresión** para GitHub: mantiene su camino rápido por API (sin clonar).

## Non-goals
- No se agrega un registry/website (sigue siendo el futuro `steering.sh`).
- No se implementa OAuth/PAT propio por host (GitLab/Bitbucket tokens): la auth se
  delega al `git` del sistema. Setear tokens por host queda fuera de scope.
- No se soporta `--list` interactivo remoto sin clonar para hosts no-GitHub (ver OQ).
- No cambia el modelo de conversión ni los formatos soportados.

## User stories
- Como dev en una org que usa **GitLab self-hosted**, quiero
  `steering add https://gitlab.miempresa.com/team/kiro-steering` y que instale igual
  que con un repo GitHub.
- Como dev con mi `git` ya autenticado por **SSH**, quiero
  `steering add git@gitlab.com:team/steering.git` sin tener que generar ni exportar
  ningún token.
- Como dev, quiero `steering check` / `update` sobre una fuente GitLab/Bitbucket y
  que detecte cambios igual que con GitHub.
- Como dev, quiero apuntar a un **subdirectorio** y a un **branch/tag** específicos
  (`.../-/tree/main/packages/steering`) en cualquier host.

## Approach (resumen técnico)
Añadir un **resolver basado en `git clone`** para las fuentes `gitlab` / `git`
(y, opcionalmente, como fallback para `github`):

1. **Clonado superficial** (`git clone --depth 1 [--branch <ref>]`) del remoto a un
   directorio temporal, ejecutando el binario `git` del sistema (que ya trae las
   credenciales del usuario). El URL se pasa como **argumento**, nunca por shell.
2. **Descubrimiento** sobre el working tree clonado, reutilizando el mismo
   `discoverSteering` que ya usa el camino local (manifest → `steering/` → root).
3. **Detección de cambios** calculando el **git blob SHA localmente** con
   `computeGitBlobSha(content)` (ya existe en `blob.ts`). El lock guarda ese SHA en
   `steeringFileHash`, idéntico al de GitHub → `check`/`update` no necesitan API del
   host: re-clonan superficial, recalculan el blob SHA y comparan.
4. **Limpieza** del directorio temporal al finalizar (incluido en error/abort).

GitHub conserva su camino actual por API (no clona). El clone es el camino para el
resto de los hosts.

## Functional requirements

1. **FR-1 — Resolver Git genérico.** `resolveSource` maneja `type: 'gitlab'` y
   `type: 'git'` clonando el remoto y produciendo `SteeringFile[]` con el mismo
   shape que GitHub/local.
2. **FR-2 — Auth delegada a git.** El clone usa el `git` del sistema; para repos
   privados se apoya en SSH / credential helper / `.netrc`. **No** se requiere
   `GITHUB_TOKEN` ni `gh` para estos hosts. Si el clone falla por auth, error claro
   indicando que configure su acceso git (ej. `git clone <url>` manual para validar).
3. **FR-3 — Ref y subpath.** Respeta `parsed.ref` (branch/tag/commit) y
   `parsed.subpath`. Para subpath: clonar y leer el subdirectorio (o sparse-checkout
   si se decide optimizar — ver OQ2).
4. **FR-4 — `check` / `update` host-agnóstico.** Para fuentes git, `check`/`update`
   re-clonan superficial, recomputan el git blob SHA de cada archivo instalado y
   comparan contra `steeringFileHash` del lock. Sin llamadas a API del host.
5. **FR-5 — Lock.** `ResolvedSource.sourceType` y los locks se extienden con `'git'`
   (y/o `'gitlab'`). `sourceUrl` guarda el URL clonable para refetch; `sourceId` es
   una etiqueta normalizada legible (ej. `gitlab.com/team/repo`).
6. **FR-6 — `git` ausente.** Si el binario `git` no está disponible y la fuente lo
   requiere, error claro: instalar git o usar una fuente GitHub/local.
7. **FR-7 — Cero regresión GitHub.** El camino GitHub (API) queda intacto; los tests
   actuales siguen verdes. (Opcional: flag `--git` para forzar clone también en
   GitHub, p. ej. para repos enterprise con SSO sobre git.)
8. **FR-8 — Seguridad.** URL del remoto pasado como argumento de proceso (sin shell);
   validar esquema (`https://`, `git@`, `ssh://`); clonado a temp dir aislado con
   permisos restringidos; limpieza garantizada.

## Error handling
| Escenario | Comportamiento |
|---|---|
| `git` no instalado | Error: instalar git o usar fuente GitHub/local. |
| Clone falla por auth (privado) | Error: configurar acceso git (SSH/credential helper); sugerir validar con `git clone <url>`. |
| Ref/branch inexistente | Error claro indicando el ref pedido. |
| Subpath inexistente en el repo | Reusar el mensaje actual de "no steering files found". |
| Timeout de red | Reintentar una vez, luego fallar con mensaje claro (paridad con GitHub). |

## Open questions
- **OQ1 — Dependencia.** ¿Spawnear el `git` del sistema (cero deps nuevas, trae las
  credenciales del usuario) o agregar `simple-git`? *Propuesta: spawnear `git` del
  sistema* (consistente con el `execSync('gh auth token')` ya existente y con la meta
  de reusar la auth del usuario).
- **OQ2 — Subpath.** ¿Clonar completo y leer el subdir, o `sparse-checkout` +
  `--filter=blob:none` para repos grandes? *Propuesta: empezar simple (clone shallow
  completo) y optimizar con sparse si hace falta.*
- **OQ3 — `--list` remoto.** GitHub lista sin instalar vía API. Para hosts git, listar
  requiere clonar primero. ¿Clonar para `--list` (aceptable) o no soportar `--list`
  remoto fuera de GitHub en v1?
- **OQ4 — GitLab API.** ¿Vale la pena un camino GitLab nativo por API (como GitHub)
  para evitar el clone, o el clone genérico cubre el caso suficientemente bien?
  *Propuesta: solo clone genérico en v1; GitLab-API queda como mejora futura.*
- **OQ5 — Caché.** ¿Cachear clones entre `add`/`check`/`update` en una misma corrida
  para no clonar dos veces?

## Out of scope / futuro
- Tokens por host gestionados por la CLI (GitLab PAT, Bitbucket app password).
- Camino nativo por API para GitLab/Bitbucket (optimización de velocidad).
- Soporte de `well-known` URLs (raw single-file) como fuente instalable.

## Success criteria
- `steering add` instala desde GitLab/Bitbucket/self-hosted (HTTPS y SSH), público y
  privado, sin `GITHUB_TOKEN`.
- `check`/`update` detectan cambios correctamente en esas fuentes.
- Suite de tests GitHub/local sin regresión; nuevos tests para el resolver git
  (mock de clone / repo git local temporal).
