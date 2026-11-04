# Multi-Sphere Water Pool — Design

## Intent

Transform the Evan Wallace "WebGL Water" demo into a top-down pool where
multiple solid balls float on a simulated water surface, collide with each
other and the pool walls, can be dragged, and where clicking the water makes
ripples. The pool has a fixed, code-configurable aspect ratio (3:4,
vertically stretched).

## Goals / Non-goals

- Goals: fluid-solid bidirectional coupling (balls displace water; water
  applies buoyancy/drag), multiple balls with ball-ball + ball-wall
  collisions, drag a ball, click water for ripples, fixed top-down camera,
  code-constant aspect ratio (3 wide : 4 deep).
- Non-goals (for now): arbitrary mesh models (balls first, generic meshes
  later), runtime aspect-ratio UI, ball refraction through the water surface.

## Constraints

- Plain-script (no bundler, no modules) WebGL1 demo; keep the `lightgl.js`
  library untouched.
- Constants live in one place (`physics.js`), injected into GLSL as `const`.
- Code constants, not runtime UI:
  - `POOL_WIDTH = 3`, `POOL_DEPTH = 4` → world extents x ∈ [-1.5, 1.5],
    z ∈ [-2, 2], floor y = -1, `poolHeight = 1`.
  - `BALL_COUNT = 3`, initial balls of density < 1 (float ~half submerged).
- Physics logic must be pure and unit-testable in Node (UMD module).

## Approaches considered

1. **Generic multi-body with ball raytracing through water** — full visual
   fidelity (refraction) but sphere-specific shader raytracing that won't
   generalize to later "other models". Rejected.
2. **Generic multi-body, balls drawn as meshes** (no sphere raytrace in the
   water shader) — chosen. Forward-looking for the "replace with other
   models" goal; acceptable visual trade-off.

## Decisions

- Water simulation stays on a 256² float texture; world↔texture mapping is
  `u = x/(2·halfW)+0.5`, `v = z/(2·halfD)+0.5`. Slight wave anisotropy is
  accepted.
- Solid→fluid: `water.moveSphere` called once per ball per frame (JS loop).
- Fluid→solid: buoyancy/drag take after the repo's existing `useSpherePhysics`
  model (submersion-fraction-scaled gravity reduction + quadratic underwater
  drag), plus density-based Archimedes buoyancy so balls actually float.
  Water height+vertical-velocity read back via a 64² downsample pass.
- Balls are plain `{x,y,z,vx,vy,vz,r,density,...}` objects; renderer receives
  plain `[x,y,z]` arrays (lightgl accepts them for `vec3` uniforms).
- Camera: `angleX = -90` fixed (top-down); `angleY` constant chosen so the
  longer z axis is vertical on screen; remove orbit mode.
- Light direction is fixed (renderer's default `(2,2,-1).unit()`); remove the
  L-key light override.
- UI: remove the entire `#help` instructions panel; keep `#loading` only.
- Interaction: hit-test all balls (nearest wins) → drag; else ripple.
