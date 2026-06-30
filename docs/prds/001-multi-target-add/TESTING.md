# Testing guide — Multi-target `steering add`

Cómo ejercitar la feature. Estás en Node 20 (no ejecuta `.ts`), así que **buildeá
primero** y corré el `dist`. **Todos los comandos manuales usan `HOME` y `cwd`
sandboxeados** para no tocar tu home real.

## Setup
```bash
cd /Users/nlgonzalez/the_rest/incubator/steering.sh
pnpm build            # dist/cli.mjs

# sandbox aislado (HOME + workspace)
SB=/tmp/mt-test; rm -rf $SB; mkdir -p $SB/ws; export HOME=$SB
CLI=$PWD/dist/cli.mjs
PKG=$PWD/tests/fixtures/sample-package
cd $SB/ws
```

## Escenarios

### 1. Instalar a varios agentes con `--agent` repetido (happy path)
```bash
node $CLI add $PKG --all --agent cursor --agent kiro -y
find .cursor .kiro -type f | sort
#   .cursor/rules/{security.mdc,java-conventions.mdc}
#   .kiro/steering/{security.md,java-conventions.md}
cat steering-lock.json    # claves compuestas: security@cursor, security@kiro, ...
node $CLI list            # cada name aparece una vez por formato [cursor]/[kiro]
```
Esperado: “Installed 4 files across 2 agents (Cursor, Kiro) [workspace]”.

### 2. Autodetección multi-agente
```bash
cd $SB && rm -rf ws && mkdir -p ws/.cursor ws/.kiro && cd ws
node $CLI add $PKG --all -y          # no-TTY → instala a TODOS los detectados
find .cursor .kiro -type f | sort     # archivos en ambos
```
En terminal interactiva, en vez de instalar a todos, aparece un **multiselect**
con cursor y kiro **premarcados**.

### 3. `--all-formats` (los 8) y `--dry-run`
```bash
cd $SB && rm -rf ws && mkdir -p ws && cd ws
node $CLI add $PKG --all --all-formats --dry-run
#   lista 8 bloques (Kiro, Claude Code, Cursor, Windsurf, Copilot, OpenCode,
#   AGENTS.md, Cline) con sus archivos y warnings de degradación; no escribe nada.
```

### 4. `remove` — de todos los formatos vs. acotado por `--agent`
```bash
cd $SB && rm -rf ws && mkdir -p ws && cd ws
node $CLI add $PKG --all --agent cursor --agent kiro -y

node $CLI remove security --agent cursor -y     # solo la copia cursor
ls .cursor/rules                                 # security.mdc ya NO está
ls .kiro/steering                                # security.md SIGUE
node -e "console.log(Object.keys(require('$SB/ws/steering-lock.json').steering).sort())"
#   'security' vuelve a clave PELADA (re-normalizado), java-conventions@* siguen

node $CLI remove java-conventions -y             # de TODOS los formatos
find .cursor .kiro -type f                        # solo quedan security.* 
```

### 5. `check` / `update` por par (name, formato)
```bash
cd $SB && rm -rf ws src && mkdir -p ws && cp -r $PKG src && cd ws
node $CLI add $PWD/../src --all --agent cursor --agent kiro -y
node $CLI check                                   # todo up to date (4 items)
printf '\n- regla nueva\n' >> $SB/src/steering/security.md
node $CLI check                                   # security aparece como update en cursor Y kiro
node $CLI update -y && node $CLI check            # vuelve a up to date
```

### 6. Back-compat single-target (no regresión)
```bash
cd $SB && rm -rf ws && mkdir -p ws/.kiro && cd ws
node $CLI add $PKG --all -y
cat steering-lock.json     # claves PELADAS (security, java-conventions), sin @, sin campos de formato
```

## Limpieza
```bash
cd /Users/nlgonzalez/the_rest/incubator/steering.sh; rm -rf /tmp/mt-test; unset HOME 2>/dev/null || true
```
(Si `unset HOME` molesta a tu shell, abrí una terminal nueva.)

## Verificación automatizada
```bash
pnpm test          # 96 tests (incluye lock-keys + multi-target add/remove)
pnpm type-check
```

## Limitaciones conocidas (ver `LIMITATIONS.md` §2.1)
- **Merge edge:** dos ramas que agregan el **mismo** name a **distinto** agente
  escriben la clave pelada `name` → conflicto de git visible (no pérdida silenciosa).
- `add --all-agents` (detectados) ≠ `convert --all-agents` (los 8 menos el origen).
- AGENTS.md como destino agrega múltiples fuentes en un solo archivo.
- Sin nuevas issues de Snyk introducidas (4 LOW preexistentes, triaged).
