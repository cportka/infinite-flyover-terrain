# Infinite Flyover

An endless, procedurally generated flight through lands that never repeat. You can fly in
any direction, forever. The world remembers where you have been, but not for long: turn
back too late and the land has been made anew, and where the old world meets the new one
you cross the Borderland. Day turns to night, and reality drifts into a neon dream and back.

It starts as a quiet flyover. Press **G**, or the small glider button in the top right, to
take the controls of a glider and fly through rings of light.

**Play it:** https://cportka.github.io/infinite-flyover-terrain/

![Autumn Hollow at golden hour](public/og.jpg)

## What's in it

- **Fly anywhere, forever.** There's no track. The world is an endless plane, streamed in
  256 m chunks around you in every direction with three levels of detail and generated off
  the main thread in Web Workers. When nobody is steering, the autopilot follows the
  rivers. A floating origin keeps rendering precise after hours of flight.
- **A short memory.** Ground near you is remembered, and anything you leave behind is
  forgotten after about 40 seconds out of reach. Fly back to forgotten ground and a new
  generation of the world is born there. Unexplored ground ahead continues the current
  generation, so flying onwards never shows a seam.
- **The Borderland.** Where remembered land meets newly made land, the two worlds blend.
  The ground breaks into breathing violet rift shards and glowing cracks, mist gathers,
  obelisks and dead trees stand in the haze, and the music detunes into a drone.
- **Nine biomes** laid out as regions, with rivers winding through them: Verdant Vale, Azure
  Coast, Amethyst Wilds, Frostpeak Range, Ember Mesa, Autumn Hollow and Cinder Fields, plus
  two new ones:
  - **Requiem Moors** (gothic): spires, cathedral ruins, gravestones, lanterns, black
    mirror lakes, a crimson moon, organ chords and bells.
  - **Prismatic Expanse** (psychedelic): prism shards, floating orbs, neon polyhedra,
    mercury lakes and halos of light.

  Landmarks such as gothic gates, arches, ring gates and halos span the rivers you fly
  along.
- **Dream and reality.** About every four and a half minutes the world drifts from as real
  as it can be into a neon dream and back. Reality has smooth shading, micro-relief and true
  colour. The dream has neon contour lines climbing the hills, pulses rolling out from you,
  drifting hues, wireframe polyhedra and light pillars in the sky, and a ringed planet. It
  shows by day and by night. Press **R** to hold the dream or reality.
- **Collisions that matter (glider mode).** Everything solid has a collider and a material.
  Each hit takes hull from a 100-point maximum, and harder materials hurt more. The hull
  slowly repairs while you fly clean. At zero the glider explodes in a way that matches
  what it hit:
  - crystal shatters into a thousand colours;
  - trees burst into leaves and sparks;
  - stone collapses into dust;
  - water erupts in spray;
  - lava swallows you in fire;
  - the black mirror lakes of the moors take you.

  Every explosion throws debris and the glider's own shards, adds a fireball wherever
  something burns, sends out a shockwave, lights up the land around it, and ends with a
  short eulogy.
- **Shaders.** Fog fades into the exact sky colour behind each fragment, including height
  fog. Water has waves, Fresnel reflections, glints and foam, the lava flows, and mercury
  and black-mirror lakes reflect the sky. The day/night sky has sunsets, stars, a moon and
  aurora. Explosions light the land, and the final image goes through bloom, ACES tone
  mapping and grading.
- **Generative soundtrack.** It's synthesised live with WebAudio. Each biome has its own
  progression, including gothic organ and bells and prism sparkle. There's a drone for the
  Borderland, plus impact and explosion sounds. The game ships no audio assets at all.

## Controls

| Action | Keyboard / gamepad | Touch / mouse |
| --- | --- | --- |
| Steer (the autopilot takes over after 5 s idle) | `W` `A` `S` `D` / arrow keys / left stick | Drag anywhere |
| Glider and rings mode on/off | `G` | Glider button (top right) |
| Boost (glider mode) | `Space` / `Shift` / A / RB / RT | Hold the **Boost** button (or a second finger) |
| Camera: chase, cinematic, cockpit (glider mode) | `C` | Pause menu |
| Dream: auto, dream, reality | `R` | Pause menu |
| Pause and settings | `P` / `Esc` | ≡ button |
| Mute | `M` | Speaker button |
| Hide the HUD (photo mode) | `H` | – |
| Skip ahead in time | `T` | – |

## URL parameters

These are handy for sharing a world or jumping straight to a scene:

- `?seed=12345` picks a different world. "New world" in the pause menu does the same.
- `?t=0.75` sets the starting time of day (0 is midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset).
- `?biome=gothic` starts in a biome: `meadow`, `coast`, `mystic`, `alpine`, `mesa`,
  `autumn`, `volcanic`, `gothic` or `prism`.
- `?dream=auto|dream|real` sets the dream mode.
- `?game` starts in glider and rings mode. `?play` does the same.
- `?notitle` skips the title card.
- `?border` places the Borderland right at the start, for a look at it.
- `?quality=low|medium|high` forces a quality preset. `auto` is the default.
- `?cam=chase|cinematic|cockpit` picks the glider camera.
- `?debug` logs FPS, chunk and draw-call stats to the console.

## Development

Requires Node 20.19+ (CI uses Node 22).

```bash
npm install
npm run dev       # local dev server
npm test          # world-generation tests (node --test)
npm run build     # production build into dist/
npm run preview   # serve the production build
```

### Project layout

```
src/
  main.js               bootstrap, loop, floating origin, flyover/glider modes, settings
  world/
    noise.js            seeded simplex noise + hashing
    biomes.js           biome catalogue (terrain, palettes, liquids, atmosphere, neon, music)
    terrain.js          one generation of the world: regions, rivers, valleys, height field
    memory.js           which generation owns each cell, and how long it is remembered
    blend.js            blends neighbouring generations into the Borderland
    world.js            world view (generation cache + memory + blending) for the main thread
    props.js            procedural low-poly props and landmarks with smooth normals
    matter.js           collision materials: hardness, explosion style, eulogy
    chunkBuilder.js     chunk meshes (terrain, liquids, props) and capsule colliders
    chunkWorker.js      Web Worker wrapper
    chunkManager.js     LOD streaming in every direction, worker pool, collider queries
  render/
    shaderLib.js        shared GLSL: sky colour, fog, dream lines, explosion light
    materials.js        terrain, prop and liquid shaders (water, lava, mercury, mirror)
    sky.js              sky dome: sun, moon, stars, aurora, clouds, dream planet
    atmosphere.js       day/night keyframes, biome blending, the dream/reality cycle
    ambient.js          particles, cloud banks, birds, neon shapes and light pillars
    postfx.js           bloom + final grade (ACES, saturation, hue drift, vignette, grain)
  game/
    player.js           the flyer: free flight, autopilot, collisions, hull, cameras
    collision.js        segment/capsule maths and terrain/liquid materials
    explosions.js       material-specific explosions animated on the GPU
    rings.js            rings of light along your flight
    input.js            keyboard, pointer/touch drag, gamepad
    audio.js            generative music and sound effects
  ui/                   HUD controller + styles
tests/                  node --test suites for the world generator
```

## Deployment

`.github/workflows/deploy.yml` tests and builds every pull request. Every push to `main`
is also deployed to GitHub Pages with `actions/deploy-pages`.

To turn it on once, go to **Settings → Pages → Build and deployment** and set **Source**
to **GitHub Actions**. After that, every merge to `main` publishes the site.

The Vite build uses a relative base (`./`), so it works from the project sub-path
(`/infinite-flyover-terrain/`) or from a custom domain without any changes.
