# Multi-Sphere Water Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the WebGL Water demo into a fixed top-down pool with `BALL_COUNT` floating, colliding, draggable balls and ripples, with a 3:4 (vertically stretched), code-configurable pool aspect ratio.

**Architecture:** Extract pure, Node-testable physics into a UMD module (`physics.js`) that holds the pool constants and per-ball buoyancy/collision/wall logic. `main.js` keeps an array of plain ball objects, reads back a downsampled water height field for buoyancy, and drives the existing water simulation. `water.js`/`renderer.js` gains `HALF_W`/`HALF_D` GLSL constants so the whole world/raytrace uses the non-square pool; balls are drawn as meshes (no sphere raytrace in the water shader).

**Tech Stack:** Plain JavaScript (no bundler/modules), WebGL1 via `lightgl.js`, Node `node:test` for physics unit tests.

**Spec:** `docs/superpowers/specs/2026-11-04-multisphere-water-design.md`

## Global Constraints

- Do not modify `lightgl.js`, `cubemap.js`, or `OES_texture_float_linear-polyfill.js`.
- Pool constants: `POOL_WIDTH = 3`, `POOL_DEPTH = 4`, world x ∈ [-1.5, 1.5], z ∈ [-2, 2], floor y = -1.
- `BALL_COUNT = 3`; ball densities < 1 so they float.
- Physics logic in `physics.js` must have no DOM/WebGL dependencies and must be loadable both as a browser global (`Physics`) and via CommonJS (`module.exports`) for Node tests.
- Do not commit unless the user explicitly asks; ask before the first commit.

## Review Focus

The spec implies behavior no single task lays out explicitly. These are the most likely things to bite a user:

1. **Ball dragged or integrated outside the pool** must be clamped and bounced, not vanish — pinned in Task 1 (`resolveWall`).
2. **Two balls spawning/ending overlapping** must separate without `NaN` — pinned in Task 1 (`resolveBallBall`).
3. **A dense ball sinking** must bounce off the floor and stay in the pool — pinned in Task 1 (`resolveWall` floor case).
4. **Ripple/drag near the pool edge** must still hit the water or a ball (pick bounds use `HALF_W`/`HALF_D`) — verified manually in Task 5.
5. **The whole pool must be visible** from the fixed camera — verified manually in Task 5 (camera distance/fit).

---

### Task 1: Physics module and unit tests

**Files:**
- Create: `physics.js`
- Test: `test/physics.test.js`

**Interfaces:**
- Produces (consumed by Tasks 2–4): global/module object `Physics` with:
  - constants: `POOL_WIDTH = 3`, `POOL_DEPTH = 4`, `HALF_W = 1.5`, `HALF_D = 2.0`, `POOL_BOTTOM = -1`, `GRAVITY = 4` (downward magnitude), `WATER_DENSITY = 1`, `RESTITUTION = 0.7`
  - `worldToTex(x, z) -> {u, v}` where `u = x/POOL_WIDTH + 0.5`, `v = z/POOL_DEPTH + 0.5`
  - `texToWorld(u, v) -> {x, z}`
  - `createBall(x, y, z, r, density) -> {x, y, z, vx:0, vy:0, vz:0, r, density, mass, prev:{x,y,z}}`
  - `submergedVolume(r, y, h) -> number` (spherical-cap volume below `h`, clamped to `[0, full]`)
  - `verticalAccel(ball, h) -> number` (net y-accel from gravity + buoyancy; no drag when velocity is zero)
  - `stepBall(ball, h, vyWater, dt) -> ball` (semi-implicit Euler: gravity reduced by submersion fraction + density-based buoyancy + quadratic water drag `-k·submerged·|v|·v` (mirroring the repo's existing `useSpherePhysics` drag) + water velocity coupling; mutates & returns)
  - `resolveBallBall(a, b) -> void` (positional separation + inverse-mass impulse with `RESTITUTION`)
  - `resolveWall(ball) -> void` (clamp to `HALF_W`/`HALF_D`/`POOL_BOTTOM` and reflect velocity with `RESTITUTION`)

- [ ] **Step 1: Write the failing tests**

`test/physics.test.js` using `node:test`:
```js
const test = require('node:test');
const assert = require('node:assert');
const Physics = require('../physics.js');
const { approx, close } = { approx: (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`), close: assert.ok };
```

Tests:
- `worldToTex` maps corners: `worldToTex(0,0)` → `{u:.5,v:.5}`; `worldToTex(HALF_W,HALF_D)` → `{u:1,v:1}`; `worldToTex(-HALF_W,-HALF_D)` → `{u:0,v:0}`; `texToWorld(worldToTex(-1,-1.5))` ≈ `{x:-1,z:-1.5}`.
- `submergedVolume`: fully above `submergedVolume(.25, 1, 0) === 0`; half `submergedVolume(.25, 0, 0)` ≈ `0.5 * 4/3*Math.PI*.25**3`; fully below `submergedVolume(.25, -.5, 0)` ≈ `4/3*Math.PI*.25**3`.
- `verticalAccel` equilibrium: for `density=0.5`, `r=.25`, `y=0`, `h=0`, result ≈ `0`; fully submerged (`y=-.5`) result > `0`.
- `resolveBallBall`: `a=createBall(-.2,.2,0,.25,1)`, `a.vx=1`; `b=createBall(.2,0,0,.25,1)`, `b.vx=-1`; after call, distance(`a`,`b`) ≥ `.5` and `a.vx < 0` and `b.vx > 0` (pushed apart, equal-mass swap).
- `resolveWall`: `b=createBall(HALF_W-.25+.1, 0, 0, .25, 1)`, `b.vx=1` → after, `b.x <= HALF_W-.25` and `b.vx < 0`. Floor: `b=createBall(0,-.9,0,.25,1)`, `b.vy=-1` → `b.y >= POOL_BOTTOM+.25` and `b.vy > 0`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/physics.test.js`
Expected: FAIL (`Cannot find module '../physics.js'`)

- [ ] **Step 3: Implement `physics.js`**

UMD wrapper: `(function(root, factory){ if (typeof module==='object'&&module.exports) module.exports=factory(); else root.Physics=factory(); })(typeof self!=='undefined'?self:this, function(){ ... return Physics; });`

Implement the math: constants derived (`HALF_W = POOL_WIDTH/2`); spherical-cap volume `V(d) = π/3·d²·(3r−d)` with submerged depth `d = clamp(r − (y − h), 0, 2r)`; `verticalAccel = GRAVITY * (WATER_DENSITY*V_sub/(ball.density*V_total) − 1)` with `V_total = 4/3·π·r³`; `stepBall` integrates `vy += verticalAccel*dt`, `vy += (vyWater − vy)*k_submerged*dt`, positions += velocity*dt; `resolveBallBall` finds overlap along the center axis, positions each back by half overlap, applies impulse `j = (−(1+e)·relVel·n) / 2` on equal masses; `resolveWall` clamps and flips the offending velocity component multiplied by `RESTITUTION`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/physics.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit (only if the user has asked to commit)**

```bash
git add physics.js test/physics.test.js
git commit -m "feat: add pool physics module and unit tests"
```

---

### Task 2: Water simulation changes

**Files:**
- Modify: `water.js`

**Interfaces:**
- Consumes: `Physics.HALF_W`, `Physics.HALF_D` (Task 1).
- Produces (consumed by Task 4):
  - `water.addDrop(x, z, radius, strength)` — now takes **world** coords.
  - `water.moveSphere(oldCenter, newCenter, radius)` — now takes **world** coords; unchanged signature.
  - `water.updateHeightField()` — fills the internal readback grid.
  - `water.sampleHeight(x, z) -> {h, vy}` — world coords → bilinear `{height, velocityY}`.

- [ ] **Step 1: Inject `HALF_W`/`HALF_D` constants into `dropShader` and `sphereShader`**

In `Water()`, prepend `const float HALF_W = <Physics.HALF_W>; const float HALF_D = <Physics.HALF_D>;` to those two shader sources.

- [ ] **Step 2: Fix `dropShader` to use world→texture mapping**

Replace the drop distance with world-space distance: `vec2 world = vec2((coord.x-0.5)*2.0*HALF_W, (coord.y-0.5)*2.0*HALF_D); float drop = max(0.0, 1.0 - length(world - center) / radius);` (the `center` uniform becomes world `[x,z]`).

- [ ] **Step 3: Fix `sphereShader` (`moveSphere`) to map texel→world**

Inside `volumeInSphere`, replace `vec3(coord.x*2.0-1.0, 0.0, coord.y*2.0-1.0)` with `vec3((coord.x-0.5)*2.0*HALF_W, 0.0, (coord.y-0.5)*2.0*HALF_D)` so `toCenter = world − newCenter` uses world distance.

- [ ] **Step 4: Add height-field readback**

Add in `Water()`: `this.heightTex = new GL.Texture(64, 64, { type: gl.FLOAT, filter: gl.LINEAR })`, `this.heightData = new Float32Array(64*64*4)`, and a `downsampleShader` (same vertex shader; fragment samples `texture` and writes `gl_FragColor = texture2D(texture, coord)`). Add `updateHeightField()` (draw `textureA` into `heightTex`, then `gl.readPixels(0,0,64,64,gl.RGBA,gl.FLOAT,this.heightData)`) and `sampleHeight(x, z)` (convert via `Physics.worldToTex`, map to grid `row/col`, bilinear-interpolate `.r`→`h` and `.g`→`vy`).

- [ ] **Step 5: Verify `water.js` no longer assumes a unit pool**

Grep `water.js` for `* 0.5 + 0.5` and `* 2.0 - 1.0`: only the `updateShader`/`normalShader` grid math remains (which is intentionally texture-space). Confirm `delta` is still `[1/width, 1/height]`.

- [ ] **Step 6: Commit (only if the user has asked)**

```bash
git add water.js
git commit -m "feat: add aspect-ratio mapping and height readback to water sim"
```

---

### Task 3: Renderer changes

**Files:**
- Modify: `renderer.js`

**Interfaces:**
- Consumes: `Physics.HALF_W`, `Physics.HALF_D` (Task 1).
- Produces (consumed by Task 4):
  - `renderer.renderSphere(x, y, z, r)` — draw one ball mesh at world position (replaces `renderSphere()`).
  - `renderer.renderWater(water, sky)` and `renderer.renderCube()` no longer take sphere uniforms.

- [ ] **Step 1: Inject `HALF_W`/`HALF_D` into `helperFunctions` and every shader via it**

Add `const float HALF_W = ...; const float HALF_D = ...;` to `helperFunctions` (near `poolHeight`), and add a `worldToTex(vec3 p)` helper: `return vec2(p.x/(2.0*HALF_W)+0.5, p.z/(2.0*HALF_D)+0.5);`. Replace every `point.xz * 0.5 + 0.5` and `position.xz * 0.5 + 0.5` (in `getSphereColor`, `getWallColor`, the water fragment shader) with `worldToTex(point)`/`worldToTex(position)`.

- [ ] **Step 2: Scale the water mesh and cube mesh to the pool size**

In the water vertex shader after `position = gl_Vertex.xzy;` add `position.x *= HALF_W; position.z *= HALF_D;`. In the cube vertex shader after `position = gl_Vertex.xyz;` add `position.x *= HALF_W; position.z *= HALF_D;` (the y mapping stays).

- [ ] **Step 3: Replace hard-coded unit-cube bounds and wall detection**

Replace `vec3(-1.0, -poolHeight, -1.0), vec3(1.0, 2.0, 1.0)` with `vec3(-HALF_W, -poolHeight, -HALF_D), vec3(HALF_W, 2.0, HALF_D)` everywhere (`getSurfaceRayColor`, `getWallColor`, `project`, caustics rim shadow). Replace `abs(point.x) > 0.999` / `abs(point.z) > 0.999` wall tests with `abs(point.x) > HALF_W - 0.001` / `abs(point.z) > HALF_D - 0.001`, and scale the wall UV lookups (`point.yz`, `point.yx`) to use `/ (2.0*HALF_D)` etc. so tiles stay consistent.

- [ ] **Step 4: Remove single-sphere raytrace/AO/shadow**

In the water fragment `getSurfaceRayColor`, delete the `intersectSphere(origin, ray, sphereCenter, sphereRadius)` branch (the `q < 1.0e6` path). In `getWallColor`, delete the sphere ambient-occlusion term and the `sphereCenter`/`sphereRadius` references; in `getSphereColor` wall AO, replace the `1.0` wall offsets with `HALF_W`/`HALF_D`. In `causticsShader` fragment, delete the blob-shadow block (the `dir`/`area`/`shadow`/`dist` lines). Remove `sphereCenter`/`sphereRadius` uniforms from `waterShaders`, `cubeShader`, and `causticsShader` and their `uniforms({...})` calls in `renderWater`, `renderCube`, `updateCaustics`.

- [ ] **Step 5: Make the sphere shader per-ball**

Change `renderSphere` to `renderSphere(x, y, z, r)` that sets `sphereCenter: [x,y,z]`, `sphereRadius: r` (plain arrays) and draws `this.sphereMesh`. Remove the now-unused `this.sphereCenter`/`this.sphereRadius` fields.

- [ ] **Step 6: Commit (only if the user has asked)**

```bash
git add renderer.js
git commit -m "feat: render pool at aspect ratio and draw balls as meshes"
```

---

### Task 4: App logic rewrite

**Files:**
- Modify: `main.js`

**Interfaces:**
- Consumes: `Physics` (Task 1), `water.*` (Task 2), `renderer.*` (Task 3).
- Produces: the running demo.

- [ ] **Step 1: Replace single-sphere state with a ball array**

Delete `center`, `oldCenter`, `velocity`, `gravity`, `radius`, `useSpherePhysics`. Add `var balls = [` 3 (or `Physics.BALL_COUNT`) `Physics.createBall(...)` calls with densities `0.5/0.45/0.4` and varied radii, initial `y` above the water.

- [ ] **Step 2: Fix camera and drop setup**

Set `angleX = -90` (fixed top-down); pick `angleY` so the longer z axis is vertical on screen; remove `MODE_ORBIT_CAMERA` and the `MODE_MOVE_SPHERE` plane-drag path's camera branch. Fix the light direction: delete the `if (GL.keys.L)` light-override block in `draw()` and the `L` key handler (keep `renderer.lightDir` fixed at its default). In the initial random-drops loop, generate x ∈ `[-HALF_W, HALF_W]`, z ∈ `[-HALF_D, HALF_D]`.

- [ ] **Step 3: Rewrite `update(seconds)`**

Per frame: `water.updateHeightField()`; for each ball read `var s = water.sampleHeight(ball.x, ball.z)` and `Physics.stepBall(ball, s.h, s.vy, seconds)`; for each unique pair `Physics.resolveBallBall(a, b)`; for each ball `Physics.resolveWall(ball)`; for each ball `water.moveSphere(ball.prev, ball, ball.r)` then copy `ball.prev = {x,y,z}`; then `water.stepSimulation()` × 2, `updateNormals()`, `updateCaustics(water)`. Keep `seconds > 1` guard.

- [ ] **Step 4: Rewrite interaction**

In `startDrag`, hit-test every ball with `GL.Raytracer.hitTestSphere(eye, ray, {x:ball.x,y:ball.y,z:ball.z}, ball.r)`; drag the nearest hit (store index). In `duringDrag`, move that ball along the drag plane and clamp with `Physics.resolveWall`-style bounds; `paused` drag still `updateCaustics`. If no ball hit and the world `pointOnPlane` is inside `|x|<HALF_W && |z|<HALF_D`, do `water.addDrop(pointOnPlane.x, pointOnPlane.z, worldDropRadius, 0.01)`. Remove orbit mode entirely.

- [ ] **Step 5: Draw all balls; simplify keys**

In `draw()`, keep the fixed camera transform; loop `renderer.renderSphere(ball.x, ball.y, ball.z, ball.r)` per ball (no `sphereCenter`/`sphereRadius` assignment). Remove the `G` key toggle and the `L` key (light is fixed); keep only `space` (pause).

- [ ] **Step 6: Commit (only if the user has asked)**

```bash
git add main.js
git commit -m "feat: multi-ball floating, collisions, drag, fixed top-down camera"
```

---

### Task 5: Wire-up and manual verification

**Files:**
- Modify: `webgl-water.html`

- [ ] **Step 1: Load `physics.js` before consumers; remove the help panel**

Add `<script src="physics.js"></script>` after `lightgl.js` (before `cubemap.js`/`renderer.js`/`water.js`/`main.js`). Delete the entire `#help` `<div>` (and its `#help`/`@media` CSS rules); keep `#loading`. In `main.js`, remove the `help` variable, `isHelpElement`, and the `help.clientWidth` term in `onresize` (use `width = innerWidth`).

- [ ] **Step 2: Open the page and verify behavior**

Run a local HTTP server (`python -m http.server` or `npx serve`) and open `webgl-water.html`, confirm: top-down view; full pool visible; 3 balls float (~half submerged) and bob with ripples; balls collide with each other and walls; dragging a ball moves it; clicking water makes ripples.

- [ ] **Step 3: Run the full test suite**

Run: `node --test test/physics.test.js`
Expected: PASS

- [ ] **Step 4: Commit (only if the user has asked)**

```bash
git add webgl-water.html
git commit -m "feat: load physics module and update help text"
```