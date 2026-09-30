# Porting Kinoko to TypeScript

SF Kart's driving physics (`src/egg`, `src/game`) are a line-by-line port of
[Kinoko](https://github.com/vabold/Kinoko) (MIT), an independent open-source reimplementation of a
classic Wii kart racer's physics that plays back recorded Time Trial ghosts frame for frame. Our
goal is **bit-exact** parity with Kinoko: keep a checkout of it at hand to port and diff against.

Compared against Kinoko every frame, bit for bit, any deviation in float rounding, operation order,
or aliasing shows up. So the port must be mechanical and faithful, not "inspired by".

## Layout

- One TS file per C++ `.hh`/`.cc` pair, with the same relative path:
  `source/game/kart/KartMove.{hh,cc}` → `src/game/kart/KartMove.ts`.
- Namespaces are dropped. Classes, methods, fields, enums, and constants keep their **exact C++
  names**. Fields keep the `m_` prefix, for example `this.m_speed`. Getters keep the C++ name, for
  example `speed()`. This lets separately ported files link up without coordination.
- Keep the C++ function order and structure so the files can be diffed side by side. Keep the
  `/// @addr{...}` comments as `/** @addr{...} */`. Drop other long Doxygen prose.
- Base infrastructure that is already written (do not modify without coordinating):
  - `src/egg/math/Math.ts`: `fr`, `fma`, `fms`, `sqrt`, `frsqrt`, `sin`, `cos`, `atan2`,
    `asin`, `acos`, `fmin`, `fmax`, `fclamp`, `F32_EPSILON`, `F32_MAX`, `DEG2RAD`, `RAD2DEG`,
    `F_PI`, `HALF_PI`, `DEG2FIDX`, `FIDX2RAD`, `RAD2FIDX`, `F_TAU`, `DEG2RAD360`,
    `FindRootsQuadratic`, `Hermite`, `SinCosFIdx`, `CosFIdx`, `SinFIdx`, `Atan2FIdx`.
  - `src/egg/math/Vector.ts` (`Vector2f`, `Vector3f`), `Quat.ts` (`Quatf`), `Matrix.ts`
    (`Matrix34f`), `BoundBox.ts`, `src/egg/geom/{Plane,Sphere}.ts`
  - `src/egg/core/BitFlag.ts` (`TBitFlag`, `TBitFlagExt`), `src/egg/util/Stream.ts` (`RamStream`)
  - These are bit-exact with Kinoko's C++: `tests/math.test.ts` pins their output to it.

## Floating point: every f32 operation must be rounded

JS numbers are doubles. The game uses f32. **Wrap every arithmetic result in `fr()`**
(`Math.fround`, plus flushing subnormals to zero like the hardware), one operation at a time, in C++ evaluation order (left to right for chains of the
same precedence):

```ts
// C++: f32 x = a * b + c * d - e;
const x = fr(fr(fr(a * b) + fr(c * d)) - e);
// C++: m_speed += 0.5f * m_accel;
this.m_speed = fr(this.m_speed + fr(0.5 * this.m_accel));
```

- Float literals: `0.1f` becomes `fr(0.1)`. Only dyadic values such as `1.0`, `0.5`, `2.0`, or
  `0.25` are exact without `fr`. Values like `1.3` or `0.9` are not. When unsure, wrap it. Hoist
  repeated constants to module-level `const X = fr(...)`.
- Negation and `Math.abs` are exact and need no `fr`.
- Integer → float `static_cast<f32>(i)` is `fr(i)` (exact for small ints).
- Float → int `static_cast<s32>(f)` is `Math.trunc(f)`. `static_cast<u16>(f)` is
  `Math.trunc(f) & 0xffff`.
- `EGG::Mathf::fma(x, y, z)` → `fma(x, y, z)`. Never fuse operations that C++ doesn't fuse.
  Kinoko builds with `-ffp-contract=off`.
- `std::min(a, b)` → `fmin(a, b)`, `std::max(a, b)` → `fmax(a, b)`, `std::clamp` → `fclamp`.
  These reproduce the exact comparison semantics.
- `EGG::Mathf::sqrt`, `sin`, `cos`, and so on are table- or approximation-based. Use the ports in
  `Math.ts`, never `Math.sqrt`/`Math.sin`.
- Explicit `static_cast<f64>` math in C++ (rare) must be computed in double and then `fr()` at
  the point C++ casts back to f32.
- Division: `a / b` → `fr(a / b)`.

## Value types and aliasing (most common bug source)

`EGG::Vector3f`, `Vector2f`, `Quatf`, `Matrix34f`, `BoundBox*`, and small POD structs are value
types in C++. In TS they are mutable objects, so:

- `Vector3f v = someRef;` becomes `const v = someRef.clone();` when `v` (or the source) is
  mutated later. It's fine to alias when neither side is ever mutated, but cloning is always safe.
- Member assignment `m_pos = pos;` becomes `this.m_pos.copy(pos)` (or `= pos.clone()`). Never
  store a reference to another object's vector.
- Getters returning `const T &` may return the internal object. Callers must NEVER mutate the
  result. Getters returning `T &` (non-const) return the internal object for in-place mutation.
- Operators: `a + b` → `a.add(b)`, `a - b` → `a.sub(b)`, `a * s` / `s * a` → `a.mul(s)`,
  `a * b` (component-wise vector) → `a.mulV(b)`, `-a` → `a.neg()`, `a / s` → `a.div(s)`,
  `a += b` → `a.addEq(b)`, `a -= b` → `a.subEq(b)`, `a *= s` → `a.mulEq(s)`,
  `a == b` → `a.equals(b)`, `v.set(f)` → `v.setAll(f)`.
- `Quatf`: `q * vec` → `q.mulVec(vec)`, `q * s` → `q.mulScalar(s)`, `q * r` → `q.mul(r)`,
  `q.multSwap(vec)` → `q.multSwapVec(vec)`, `Quatf::FromRPY(r, p, y)` → `Quatf.FromRPY3(r, p, y)`,
  `FromRPY(vec)` → `Quatf.FromRPY(vec)`, `setRPY(r,p,y)` → `setRPY3`.
  `Quatf(w, vec)` → `Quatf.fromWV(w, vec)`. `Quatf(w, x, y, z)` → `new Quatf(w, x, y, z)`.
- `Matrix34f`: `m[r, c]` → `m.get(r, c)` / `m.set(r, c, v)`.
- Static constants (`Vector3f.zero`, `Vector3f.ex`, `Vector3f.ey`, `Vector3f.ez`,
  `Vector3f.unit`, `Vector3f.inf`, `Quatf.ident`, `Matrix34f.ident`, `Matrix34f.zero`) are
  frozen. Never pass them somewhere they will be mutated. Clone first.
- `std::array<Vector3f, N>` members become arrays of distinct instances created in the
  constructor.
- Uninitialized C++ members: initialize to `0` / new zero vectors in TS.

## Out-parameters

- For an object out-param (`EGG::Vector3f &out`, `CollisionInfo &info`, `CollisionInfo *info`), the
  TS function takes the object (or `null` for a nullable pointer) and mutates it in place with
  `.copy()` or field writes. It never replaces the caller's reference.
- For a primitive out-param (`f32 &`, `bool &`, `u16 &`, `KCLTypeMask *`), ALWAYS use
  `Box<T>` from `src/egg/core/Box.ts` (`{ value: T }`), or `Box<T> | null` for nullable pointers.
  Callers create boxes with `box(initial)`. Don't use tuples, so that all files agree.
- The keep-the-return-value rule still applies. A C++ function returning `bool` with out-params
  returns `boolean` in TS and writes its boxes.

## Integers

- JS numbers work for u8/u16/s16/u32/s32, but replicate wrap-around where it can happen
  (counters decremented below 0, u16 overflow): `x = (x - 1) & 0xffff` for u16,
  `(x << 16) >> 16` for s16, `x >>> 0` for u32, `x | 0` for s32.
- Integer division `a / b` → `Math.trunc(a / b)`.
- Bool-to-int arithmetic: `Number(b)`.

## Enums and flags

- `enum class Foo { A = 0, ... }` → `export enum Foo { A = 0, ... }` with identical names and
  values.
- `EGG::TBitFlag<T, E>` → `TBitFlag<E>`, `EGG::TBitFlagExt<N, E>` → `TBitFlagExt<E>(N)`.
  Variadic calls stay variadic: `status.onBit(eStatus.A, eStatus.B)`.

## Classes

- Inheritance and virtuals map to TS classes and `override`. Pure virtual → abstract.
- Singletons: keep `static Instance()`, `static CreateInstance()`, `static DestroyInstance()`,
  and a module-private `s_instance`.
- `KartObjectProxy` is the base class that gives every kart component access to the others through
  the shared `KartAccessor`. Its method names are exactly the ones in `KartObjectProxy.hh`.
  Overloads with an index (`collisionData()` / `collisionData(tireIdx)`) take an optional param.
- Use `import type` for imports used only as types. This avoids circular-import problems. Runtime
  cycles are OK as long as nothing is used at module-evaluation time. Never `extends` a class from
  a module that imports you back at top level.

## Skipped / stubbed

- Rendering-only code (models, effects, sounds) is skipped. `Render::KartModel::calc` and
  `KartCamera` are kept because they affect physics or the camera. `KartCamera` also carries
  render-camera logic that Kinoko omits (look-at point, half-pipe orbit and roll, collision
  push-out, wall avoidance, up vector, FOV) plus a few camera-only fields in `KartHalfPipe`; these
  are marked "Not in Kinoko" with their addresses. None of it feeds back into the physics.
- Memory/heap/allocator code, logging, and `ASSERT` (use `throw` only if it is cheap and useful).
- Course objects (`field/obj/*`) other than the ones listed under "Course objects" below.
  `ObjectDirector.createObject` throws "not supported" for every ID Kinoko implements but we have
  not ported, so a course using an unsupported object fails loudly instead of silently diverging.

## Course objects

Ported: the object framework (`ObjectBase`, `ObjectCollidable`, `ObjectNoImpl`, `StateManager`,
`ObjectFlowTable`/`ObjectHitTable` from `ObjFlow.bin`/`GeoHitTableKart*.bin`, the GJK test in
`ObjectCollisionBase`, sphere/cylinder/box shapes, `Rail`/`RailManager`/`RailInterpolator`),
the header-only parts of `abstract/g3d` (`ResFile`/`ResDic`/`ResAnmChr` info, `FrameCtrl`) and
`render/AnmMgr`/`DrawMdl` that objects read, and `ObjectHeyho` (a snowboarding course object).
Conventions:

- C++ multiple inheritance (`ObjectHeyho : ObjectCollidable, StateManager`) becomes a member
  (`m_stateMgr`) that forwards `m_currentStateId` and `StateManager::calc()`.
- `m_pos` of an object is referenced live by its `BoxColUnit`; only mutate it in place (`setPos`).
- Reach objects through `ObjectDirector` (or `import type`): `ObjectBase` imports `ObjectDirector`,
  which imports the concrete objects, so importing `ObjectBase` first would break the class cycle.
- Uninitialized C++ members are zero (Kinoko's release heaps zero-fill), e.g. `m_currentAnim`.
- Kinoko never advances animation frames (`AnmNodeChr::frame()` is always 0), so anything gated
  on an animation finishing (Heyho's Jumped → Move) never fires; we match Kinoko here.
- The flow/hit tables are optional in the Core archive: our generated courses boot without them
  (they have no objects); any table lookup then throws.

## Testing

- `npx tsc --noEmit` must be clean for your files.
- `tests/math.test.ts` checks the math core against a hash of Kinoko's C++ output for the same
  sequence (`tests/mathTrace.ts` prints it, to diff by hand). A differential harness that runs
  a native Kinoko build and the port on the same course and inputs and compares the per-frame state
  bit for bit is not part of this repository yet.
