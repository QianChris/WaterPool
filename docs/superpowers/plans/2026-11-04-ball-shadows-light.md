# Ball Shadows and Directional Light on Balls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the three floating balls a clearly visible directional light/shade on their surfaces, and hard shadows on the pool's light map (caustics texture).

**Architecture:** Both changes are pure shader/uniform changes in `renderer.js` plus a `balls` argument threaded through `updateCaustics` in `main.js`. Ball shading is rewritten in the shared `getSphereColor` helper; ball shadows are added to the `causticsShader` fragment shader as a ray-sphere occlusion test along the same refracted-light ray the pool-rim shadow already uses.

**Tech Stack:** Plain JavaScript, WebGL1 via `lightgl.js`, GLSL ES 1.0.

**Spec:** `docs/superpowers/specs/2026-11-04-ball-shadows-design.md`

## Global Constraints

- Do not modify `lightgl.js`, `cubemap.js`, `OES_texture_float_linear-polyfill.js`, `physics.js`, or `water.js`.
- WebGL1 / GLSL ES 1.0 only.
- `BALL_COUNT = 3`; the shadow shader hardcodes `uniform vec4 sphere[3]`.
- Do not commit unless the user explicitly asks.

## Review Focus

The spec is a vision document; these are the conditions most likely to bite a person using the demo:

1. **Dragging a ball to the pool edge/corner** must not darken the whole light map or produce NaN (the shadow test must stay finite). `intersectSphere` already returns `1.0e6` for no-hit, so a ball that misses every ray just doesn't shadow. Manual check: drag a ball to a corner; the rest of the floor stays lit.
2. **The shadow must track the ball live** — `balls` is passed by reference and read every `updateCaustics` call. Manual check: drag a ball; its shadow follows without a one-frame stale offset.
3. **The shadow sits on the correct side** — away from the light. `light = (2,6,-1).unit()`, so the shadow falls toward −x/+z. Manual check: confirm the shadow is on the far side of each ball.
4. **Lit vs dark hemispheres are clearly distinct** on each ball (ambient `0.15` vs diffuse `0.85`). Manual check: each ball has an obvious bright side facing the light and a dim side away.
5. **Underwater caustics still brighten the ball undersides.** Manual check: ball undersides flicker with the caustic pattern when the water ripples.

---

### Task 1: Directional light shading on balls

**Files:**
- Modify: `renderer.js` (the `getSphereColor` helper, lines 51–72)

**Interfaces:**
- Consumes: existing `sphereCenter`, `sphereRadius`, `light`, `water`, `causticTex` uniforms (unchanged).
- Produces: visibly shaded balls; no signature changes.

- [ ] **Step 1: Replace the `getSphereColor` body**

Replace the body of `getSphereColor` (renderer.js:51–72) with the following, preserving the surrounding GLSL `\` line-continuation escapes:

```glsl
vec3 getSphereColor(vec3 point) {
    vec3 sphereNormal = (point - sphereCenter) / sphereRadius;
    vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
    float ndl = max(0.0, dot(-refractedLight, sphereNormal));

    /* directional light: lit side bright, dark side dim */
    vec3 color = vec3(0.15);

    vec4 info = texture2D(water, worldToTex(point));
    if (point.y < info.r) {
      /* underwater: caustics brighten the lit hemisphere */
      vec3 shifted = vec3(point.x - point.y * refractedLight.x / refractedLight.y, 0.0, point.z - point.y * refractedLight.z / refractedLight.y);
      float caustic = texture2D(causticTex, worldToTex(shifted)).r * 4.0;
      color += vec3(0.85) * ndl * caustic;
    } else {
      color += vec3(0.85) * ndl;
    }

    /* ambient occlusion with walls */
    color *= 1.0 - 0.9 / pow((HALF_W + sphereRadius - abs(point.x)) / sphereRadius, 3.0);
    color *= 1.0 - 0.9 / pow((HALF_D + sphereRadius - abs(point.z)) / sphereRadius, 3.0);
    color *= 1.0 - 0.9 / pow((point.y + 1.0 + sphereRadius) / sphereRadius, 3.0);

    return color;
}
```

- [ ] **Step 2: Verify no regression**

Run: `node --test test/physics.test.js`
Expected: PASS (8 tests; physics is untouched, this is a sanity gate).

- [ ] **Step 3: Visual check**

Serve the demo (`python -m http.server`) and open `webgl-water.html`. Confirm each ball has a bright side facing the light and a clearly dim opposite side.

- [ ] **Step 4: Commit (only if the user has asked)**

---

### Task 2: Hard shadows on the light map

**Files:**
- Modify: `renderer.js` (caustics fragment source, lines 263–285; `updateCaustics`, line 288)
- Modify: `main.js` (three `updateCaustics` call sites: lines 153, 170, 262)

**Interfaces:**
- Consumes: `balls[]` — plain objects with numeric `x, y, z, r`.
- Produces: `renderer.updateCaustics(water, balls)` (signature change from `updateCaustics(water)`).

- [ ] **Step 1: Declare the sphere uniform array in the caustics fragment shader**

In the fragment source string for `causticsShader` (renderer.js ~line 265), after `varying vec3 ray;\` add:

```glsl
uniform vec4 sphere[3];\
```

- [ ] **Step 2: Add the shadow occlusion loop**

In the same fragment `main()`, immediately after the pool-rim shadow line (the `gl_FragColor.r *= 1.0 / (1.0 + exp(...));` line), add:

```glsl
/* hard shadow from the balls */\
for (int i = 0; i < 3; i++) {\
  if (intersectSphere(newPos, -refractedLight, sphere[i].xyz, sphere[i].w) < 1.0e6) {\
    gl_FragColor.r *= 0.0;\
  }\
}\
```

- [ ] **Step 3: Thread `balls` through `updateCaustics`**

Change the signature to `Renderer.prototype.updateCaustics = function(water, balls)` and, inside the `causticTex.drawTo` callback, build the sphere uniforms from `balls` (indices `0..2`, value `[x,y,z,r]`) and pass them in the `.uniforms({...})` call. lightgl's `uniform4fv` path handles a 4-element array at a `sphere[i]` location.

```js
this_.causticsShader.uniforms({
  light: this_.lightDir,
  water: 0,
  'sphere[0]': [balls[0].x, balls[0].y, balls[0].z, balls[0].r],
  'sphere[1]': [balls[1].x, balls[1].y, balls[1].z, balls[1].r],
  'sphere[2]': [balls[2].x, balls[2].y, balls[2].z, balls[2].r]
}).draw(this_.waterMesh);
```

- [ ] **Step 4: Update the three call sites in `main.js`**

Change `renderer.updateCaustics(water)` to `renderer.updateCaustics(water, balls)` at lines 153, 170, and 262.

- [ ] **Step 5: Verify no regression**

Run: `node --test test/physics.test.js`
Expected: PASS (8 tests).

- [ ] **Step 6: Visual check**

Serve the demo and open `webgl-water.html`. Confirm: each ball casts a hard shadow on the floor on its far (away-from-light) side; the shadow tracks the ball while dragging; the rest of the floor stays lit when a ball is dragged to a corner.

- [ ] **Step 7: Commit (only if the user has asked)**
