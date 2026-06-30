# Incu — Design System

> **We build what's next.**
> El partner de desarrollo que ayuda a empresas, startups y agencias creativas a llevar ideas audaces a la realidad.

Esta es la documentación de estilos del **Incu Design System**: una identidad **neón sobre negro** para una software factory argentina (~15 devs) especializada en desarrollo de software a medida, arquitectura técnica y adopción de IA.

La regla mental: **el negro es la página, el neón es el foco.** Un solo neón por superficie, usado como fondo full-bleed o como glow puntual. Texto blanco sobre negro por defecto.

---

## 1. Fundamentos visuales

- **Canvas por defecto:** `--c-void` (`#0A0A0C`). Todo vive sobre negro.
- **Color = spotlight.** Un neón a la vez. Las mezclas de dos neones son composiciones deliberadas (degradé violeta→magenta sobre el isotipo), nunca arcoíris suaves.
- **El borde es el separador de superficies**, no el fill ni la sombra. Hairline `rgba(255,255,255,0.12)`.
- **Elevación = glow**, no drop shadow. Un radial suave violeta / cyan / lime indica importancia.
- **Esquinas rectangulares.** Default `0`; máximo `6px` para cards "soft". Pills (999px) solo para tags y chips.

---

## 2. Color

### Marca

| Token | Hex | Rol |
|---|---|---|
| `--c-violet` | `#B100FF` | **Primario** — Neon Hyper Violet. El color de billboard. |
| `--c-violet-deep` | `#8A00FF` | Plasma Violet — paso pressed / oscuro. |
| `--c-magenta` | `#FF0DF5` | Secundario — Electric Magenta. |
| `--c-magenta-2` | `#FF0F8A` | Variante Hot Magenta. |
| `--c-cyan` | `#00F6FF` | Secundario — Laser Cyan. |
| `--c-cyan-2` | `#00E5FF` | Variante Laser Cyan. |
| `--c-lime` | `#D9FF00` | **Acento** — Acid Lime. Focus rings, success, momentos "mirá acá". Nunca como color de body. |
| `--c-lime-2` | `#C4FF0E` | Variante Lime. |
| `--c-orange` | `#FF7A00` | Complemento cálido — Fusion Orange. Uso escaso (moodboard / ilustración). |
| `--c-red` | `#FF2E2E` | Signal Red — error / urgencia. |

### Neutrales

| Token | Valor | Rol |
|---|---|---|
| `--c-void` | `#0A0A0C` | Canvas. |
| `--c-ink` | `#000000` | True black — extremo. |
| `--c-graphite` | `#1F2937` | Surface 1. |
| `--c-slate` | `#2B0D31` | Tinte de superficie plum. |
| `--c-paper` | `#FFFFFF` | Foreground / luz pura. |
| `--c-mist` | `rgba(255,255,255,0.72)` | FG secundario. |
| `--c-fog` | `rgba(255,255,255,0.48)` | FG terciario. |
| `--c-haze` | `rgba(255,255,255,0.16)` | FG mute. |
| `--c-line` | `rgba(255,255,255,0.12)` | Hairline / borde estándar. |
| `--c-line-strong` | `rgba(255,255,255,0.32)` | Borde fuerte. |

El texto blanco usa opacidades escalonadas: **100% → 72% → 48% → 16%**. El body nunca va sobre un fondo neón — el neón es marco, no página.

### Tokens semánticos (dark-first)

```
--bg            #0A0A0C (void)      --fg-1   #FFFFFF (paper)
--bg-elev-1     #14141A             --fg-2   rgba(255,255,255,.72)
--bg-elev-2     #1B1B22             --fg-3   rgba(255,255,255,.48)
--surface       #1F2937 (graphite)  --fg-mute rgba(255,255,255,.16)

--border        rgba(255,255,255,.12)   --accent       #B100FF
--border-strong rgba(255,255,255,.32)   --accent-hover #C233FF
--focus-ring    #D9FF00 (lime)          --accent-press #8A00FF

--success #00FAAF   --warning #FF7A00   --danger #FF2E2E
```

### Degradés (isotipo + flourishes)

```
--grad-violet   linear-gradient(180deg, #B100FF 0%, #FF0DF5 100%)
--grad-cyan     linear-gradient(180deg, #00F6FF 0%, #B100FF 100%)
--grad-emerald  linear-gradient(180deg, #00BA96 0%, #00D9AF 46%, #00FAAF 100%)
--grad-sunset   linear-gradient(180deg, #FF7A00 0%, #FF0F8A 60%, #B100FF 100%)
```

**Prohibido:** degradés pastel, mesh gradients, fondos light-mode stock-y.

---

## 3. Tipografía

| Rol | Familia | Token | Notas |
|---|---|---|---|
| **Display** | Dela Gothic One | `--font-display` | Voz más fuerte. 96–500px. Solo Regular (400). `line-height: 0.9`, `letter-spacing: -0.02em`. |
| Body / UI | Satoshi (fallback Inter) | `--font-body` | Geométrica, peso parejo. 16px body, 21px lede. |
| Serif | Newsreader (fallback Hedvig Letters) | `--font-serif` | Contrapunto experimental. |
| Mono | JetBrains Mono | `--font-mono` | Code y stack callouts. Renderiza en `--c-lime`. *(Sustituto — no está en el Figma.)* |

### Escala

| Token | Tamaño | Uso |
|---|---|---|
| `--fs-display-xl` | `clamp(72px, 9vw, 130px)` | Hero — "We build what's next." |
| `--fs-display-l` | `clamp(56px, 6.5vw, 96px)` | Display grande. |
| `--fs-display-m` | `clamp(40px, 4.5vw, 64px)` | Display medio. |
| `--fs-h1` | `clamp(34px, 3.4vw, 48px)` | Satoshi 700, `ls -0.01em`. |
| `--fs-h2` | `clamp(28px, 2.6vw, 36px)` | Satoshi 600. |
| `--fs-h3` | `22px` | Satoshi 600. |
| `--fs-h4` | `18px` | Satoshi 500. |
| `--fs-body-l` | `21px` | Lede — Satoshi 500, color `--fg-2`. |
| `--fs-body` | `16px` | Body. |
| `--fs-body-s` | `14px` | Body chico. |
| `--fs-caption` | `13px` | Caption — `--fg-3`. |
| `--fs-eyebrow` | `12px` | Eyebrow — UPPERCASE, `ls 0.16em`, `--fg-3`. |

**Line-heights:** display `0.9` · headline `1.05` · body `1.5` · tight `1.3`.

---

## 4. Voz y contenido

- **Confiada, no ruidosa.** Afirmaciones, no preguntas. Puntos, no signos de exclamación.
- **Primera persona plural.** "We build…", "We decode…". El "you" solo en CTAs / forms ("Tell us about your project").
- **Sentence case con punto final.** *We build what's next.*
- **incu** en minúscula como glifo de wordmark; en prosa corrida **Incu** con I mayúscula.
- Eyebrows / labels en **MAYÚSCULA** con tracking 0.16em.
- **Sin emoji. Nunca.** Para status usar un dot de color o un ícono Lucide.
- Bilingüe: español para mercado argentino (voseo: "contanos"), inglés para posicionamiento internacional y headlines. Los conceptos técnicos quedan en inglés aun en copy español.
- Anclar en clientes y stacks concretos (Next.js, NestJS, Kafka) — no en "cutting-edge tech".

| Do | Don't |
|---|---|
| "Built in Buenos Aires. Shipping to the world." | "🚀 We innovate fintech solutions!" |
| Puntos. Frases cortas. | Frases largas con punto y coma. |
| Nombrar el stack. | Mistificarlo. |

---

## 5. Espaciado y radios

**Spacing:** `--s-1`…`--s-10` = `4 · 8 · 12 · 16 · 24 · 32 · 40 · 56 · 80 · 120px`.

**Radios:** `--r-0` 0 · `--r-1` 2px · `--r-2` 6px · `--r-3` 12px · `--r-4` 20px · `--r-pill` 999px.
Default **0** en superficies, **6px** en inputs, **12px** en cards soft. La marca es rectangular.

**Layout:** frames Figma 1440×770. Breakpoints 1440 / 1024 / 390. Gutters 40px desktop. Grid implícito de 12 columnas. Section padding 80–120px desktop, 56px mobile. **El wordmark va arriba a la derecha** en heros; el lede arriba a la izquierda.

---

## 6. Elevación, glow y sombras

```
--shadow-0  0 0 0 1px var(--border)
--shadow-1  0 1px 2px rgba(0,0,0,.4), 0 0 0 1px var(--border)
--shadow-2  0 8px 24px rgba(0,0,0,.5), 0 0 0 1px var(--border)
--shadow-3  0 24px 60px rgba(0,0,0,.6), 0 0 0 1px var(--border)

--glow-violet  0 0 32px rgba(177,0,255,.55), 0 0 80px rgba(177,0,255,.25)
--glow-cyan    0 0 32px rgba(0,246,255,.55), 0 0 80px rgba(0,246,255,.25)
--glow-lime    0 0 32px rgba(217,255,0,.55), 0 0 80px rgba(217,255,0,.25)
```

- **Sin drop shadow tradicional sobre superficies oscuras.** Usar `0 0 0 1px` border + glow neón.
- Inner shadow solo en inputs para profundidad: `inset 0 1px 0 rgba(0,0,0,.4)`.
- Backdrop blur solo en overlays de modal: `blur(24px)` sobre `rgba(10,10,12,0.6)`. Nunca blur "de profundidad" en cards.

---

## 7. Componentes

### Botones — `padding: 14px 22px`, `radius: 6px`, peso 600, 15px, transición 160ms `cubic-bezier(.16,.84,.3,1)`

| Variante | Reposo | Hover |
|---|---|---|
| **Primary** | bg `#B100FF`, texto blanco | bg `#C233FF` + glow `0 0 24px rgba(177,0,255,.45)` |
| **Secondary** | transparente, borde `rgba(255,255,255,.32)` | bg `rgba(255,255,255,.06)`, borde `.6` |
| **Accent (lime)** | bg `#D9FF00`, texto `#0A0A0C` | + glow `0 0 24px rgba(217,255,0,.45)` |
| **Ghost** | transparente, texto `rgba(255,255,255,.85)` | texto `#B100FF` |

Variante `sm`: `padding 9px 14px`, 13px. La flecha `→` va en `--font-mono`.

### Cards — `border: 1px solid rgba(255,255,255,.12)`, `radius: 6px`, `padding: 18px 20px`, fondo transparente

- **Default** — hairline sobre transparente.
- **Filled** — bg `#14141A` (elev-1).
- **Active** — borde `rgba(177,0,255,.55)` + glow `0 0 24px rgba(177,0,255,.25)`.
- **Gradient** — bg `linear-gradient(180deg, rgba(177,0,255,.16) 0%, transparent 100%)`, borde `rgba(177,0,255,.35)`.

La flecha `→` final va en `--font-mono`, color `#B100FF`.

### Badges (pill 999px, 12px peso 600, `ls .04em`) y Chips (mono 11px, radio 4px)

Badges con `bg`/`color`/`border` por color a `.18`/light/`.45`: violet, cyan, lime, orange, red, neutral. Dot de 6px en `currentColor`. Ej: `b-violet` → bg `rgba(177,0,255,.18)`, texto `#E0AEFF`, borde `rgba(177,0,255,.45)`.

Chips: mono, bg `rgba(255,255,255,.06)`, borde `rgba(255,255,255,.18)` — para stack tags (TypeScript, Next.js, Kafka…).

### Form fields

- Input/select/textarea: bg `rgba(255,255,255,.04)`, borde `rgba(255,255,255,.18)`, radio 6px, `padding 11px 13px`.
- Placeholder al 40% blanco. Label 13px peso 500.
- **Focus:** borde `#D9FF00` + `box-shadow: 0 0 0 2px rgba(217,255,0,.25)` (anillo lime, siempre visible — nunca se remueve).
- **Error:** borde `#FF2E2E`, help text rojo.
- Checkbox: `accent-color: #B100FF`, 16px.

---

## 8. Estados de interacción

- **Hover** — primary aclara a `#C233FF`; secondary rellena a blanco-12%; links a `--c-violet` con underline al tono.
- **Press** — `scale(0.98)`; color un paso oscuro (`#8A00FF`).
- **Focus** — anillo Acid Lime 2px, offset 2px. Siempre visible.
- **Disabled** — 32% opacidad, sin color shift, pointer off.

---

## 9. Movimiento

| Token | Valor | Uso |
|---|---|---|
| `--dur-fast` | `120ms` | Hover. |
| `--dur-base` | `220ms` | Cambio de estado. |
| `--dur-slow` | `420ms` | Reveal a nivel de página. |
| `--ease-out` | `cubic-bezier(.16,.84,.3,1)` | Movimiento natural por defecto. |
| `--ease-in-out` | `cubic-bezier(.65,.05,.36,1)` | Transiciones simétricas. |
| `--ease-spring` | `cubic-bezier(.5,1.6,.4,1)` | Solo feedback chico (press scale). |

Patrón de entrada: fade + `translateY(8px) → 0`. **Prohibido:** blobs flotantes, parallax on-scroll, gradientes SVG animados de fondo.

---

## 10. Iconografía e imágenes

- **Lucide** (CDN) como set sustituto: stroke 2px a 24px, `currentColor`, nunca filled ni duotone. Shift a `--c-violet` en hover interactivo.
- Íconos decorativos o funcionales — nunca 5 íconos armando una "feature".
- Glifos de marca (isotipo "I" entrelazada) son SVG, no parte del icon font.
- **Imágenes:** tonalidad fría (purple/cyan/magenta), grano fino. B&N + un acento neón. Sin editorial cálido sepia salvo dentro de composiciones Fusion Orange.
- Moodboard: gradientes diamante abstractos, foil holográfico, humo violeta — full-bleed, nunca como thumbnails decorativos.

### Logos (`assets/`)
- `logo_incu.svg` — wordmark **incu** blanco. + PNG 1x/2x/3x.
- `isotipo.svg` — marca "I" entrelazada standalone. + PNG 1x/2x/3x.

### Caracteres Unicode
Solo como acentos tipográficos: `—` (em dash, el preferido), `→` (CTAs), `·` (separador). Nunca `★`, `✓` ni ornamentos.

---

*Fuente: `colors_and_type.css` + brand book Incu. Sin codebase de producción — los componentes son reconstrucciones brand-faithful. Para mayor fidelidad, compartir repo o URL de producción.*
