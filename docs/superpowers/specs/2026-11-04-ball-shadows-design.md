# Ball Shadows and Directional Light on Balls — Design

## Intent

Two related lighting improvements:

1. The three floating balls currently do not occlude the directional light: the
   pool floor and walls show water caustics but no ball shadows. Add hard
   shadows cast by the balls, overlaid onto the existing caustics "light map"
   (`causticTex`), so the balls darken the floor/walls beneath them.
2. The balls' own shading is currently near-flat gray with only a weak
   `diffuse` term. Make the same directional light visibly shade each ball
   (lit side bright, dark side dim).

## Goals / Non-goals

- Goals: a hard (hard-edged) shadow for each of the 3 balls on the light map;
  a clearly visible directional light/shade on each ball.
- Non-goals: soft/penumbra shadows, shadows on the water surface or the
  reflected above-water view, mutual or self shadowing between balls, a
  specular highlight, changing physics or the water simulation.

## Constraints

- Keep `lightgl.js`, `cubemap.js`, `OES_texture_float_linear-polyfill.js`,
  `physics.js`, and `water.js` untouched.
- WebGL1 / GLSL ES 1.0. Ball data flows from `main.js` (`balls[]`) into the
  renderer as plain arrays.

## Approaches considered

1. **Overlay in the caustics shader (chosen).** In `causticsShader`'s fragment
   shader, trace the refracted-light ray from each floor texel upward
   (`-refractedLight`) and test intersection with each ball; multiply the
   caustic brightness (`gl_FragColor.r`) by 0 when occluded. Reuses the
   existing `intersectSphere` helper and the same ray the pool-rim shadow
   already uses. Ball data passed as a `uniform vec4 sphere[3]` array
   (`xyz` center, `w` radius).
2. Separate shadow-map pass then combine: more correct for soft shadows but
   heavy and unnecessary for 3 balls. Rejected.
3. Cheap projected "blob" darkening in the water surface shader: does not live
   in the light map and reads wrong for a directional light. Rejected.

## Decisions (as agreed)

- Hard shadow (hard-edged), as requested.
- The shadow lives in the caustics texture, so it appears on the floor and
  walls automatically through the existing `getWallColor` caustic sampling.
- Ball shading: directional lambertian with a lower ambient base and stronger
  diffuse contrast; no mutual/self shadowing, no specular highlight.

## What's left to the builder (my calls)

- Represent the balls as `uniform vec4 sphere[3];` in GLSL; set them through
  lightgl keys `sphere[0]`, `sphere[1]`, `sphere[2]` using plain `[x,y,z,r]`
  arrays (lightgl's `uniform4fv` path handles them).
- Shadow test, for `i` in `0..2`:
  `if (intersectSphere(newPos, -refractedLight, sphere[i].xyz, sphere[i].w) < 1.0e6) gl_FragColor.r *= 0.0;`
- Change `renderer.updateCaustics(water)` to `updateCaustics(water, balls)` and
  update its three call sites in `main.js`.
- Leave the residual floor ambient (`0.5/length(point)` pool-AO term) as-is, so
  shadows read as dark patches rather than pure black.

## What's left to the builder (my calls) — ball shading

- In `getSphereColor`, compute `sphereNormal` and
  `ndl = max(0.0, dot(-refractedLight, sphereNormal))` first, then shade as
  `color = vec3(AMBIENT) + vec3(DIFFUSE) * ndl`, then apply the existing wall
  ambient-occlusion multipliers, then the underwater caustic term. Pick
  `AMBIENT ≈ 0.15` and `DIFFUSE ≈ 0.85` so the dark hemisphere is clearly dim
  and the lit hemisphere bright; keep the existing underwater caustic
  brightening so balls still pick up water caustics.
