/**
 * Declarative course definitions (see tools/README.md for the full reference).
 *
 * Distances are engine world units. S ("arc length") is measured along the final spline centerline
 * from the start of the turtle program. Lateral offsets ("lat") are measured from the centerline,
 * POSITIVE TO THE DRIVER'S LEFT.
 */

import type { TurtleSeg } from './centerline';

/** KCL attribute helpers (u16 flag: type | variant << 5 | trickable 0x2000). */
export const KCL = {
    road: 0x00,
    slippery: 0x01,
    weakOffroad: 0x02,
    offroad: 0x03,
    heavyOffroad: 0x04,
    boostPanel: 0x06,
    boostRamp: (variant: 0 | 1 | 2) => 0x07 | (variant << 5),
    jumpPad: (variant: number) => 0x08 | ((variant & 7) << 5),
    wall: 0x0c,
    invisibleWall: 0x0d,
    /** A wall that keeps 70% of the speed limit along it (0x0C: 40%). */
    slickWall: 0x0f,
    fallBoundary: 0x10,
    /** Cannon activator; variant = CNPT index. */
    cannon: (point: number) => 0x11 | ((point & 7) << 5),
    /** Half-pipe ramp (variant 1 = also a boost panel). */
    halfPipe: 0x13,
    /** Invisible wall that keeps karts inside a half-pipe while airborne. */
    halfPipeWall: 0x1c,
    trickable: 0x2000,
} as const;

export type Theme = {
    /** Sky / clear color. */
    sky: string;
    /** Fog color (usually close to sky). */
    fog: string;
    /** Color of the ground plane far below / around the course. */
    ground: string;
    road: string;
    offroad: string;
    wall: string;
    /** Accent color (curbs, start arch, decorations). */
    accent: string;
};

/** A turtle segment plus optional per-segment sugar (converted into zones). */
export type SegDef = TurtleSeg & {
    /** Elevation change across the segment (cosine eased). */
    rise?: number;
    /** Hill: up by `bump` and back down across the segment. */
    bump?: number;
    /** Banking in degrees (magnitude); the outside of the corner is raised. Arcs only. */
    bank?: number;
};

/** A point on the centerline: spline start of `seg` + `at` (negative `at`: from the segment end). */
export type Ref = { seg: string; at?: number };
/** An S range: a whole segment, a sub-range of a segment, or between two refs. */
export type Range = string | { seg: string; from?: number; to?: number } | { from: Ref; to: Ref };
/** A point feature centered at `at` (spline units from the segment start) with length `len`. */
export type Span = { seg: string; at: number; len: number };
/** Lateral range [lo, hi] (lo < hi, positive = left), or a lane of an island (divided road). */
export type Lat = [number, number] | 'leftLane' | 'rightLane';

export type CrossSection = {
    /** Road half width. */
    road: number;
    /** Offroad strip widths outside the road. */
    offroadL: number;
    offroadR: number;
    /** Wall height; walls stand at the outer edge of the offroad strips. */
    wallH: number;
    /** Invisible wall (KCL 0x0D) continuing above the walls, e.g. over low barriers. */
    invisibleWallH?: number;
    wallL: boolean;
    wallR: boolean;
    /** Extra lateral breakpoints inside the road (lane lines / panel edges). */
    splits?: number[];
    roadAttr?: number;
    offroadAttr?: number;
};

export type Zone =
    | { kind: 'bump'; range: Range; height: number }
    | { kind: 'rise'; range: Range; dh: number }
    | { kind: 'bank'; range: Range; deg: number; ease?: number }
    | { kind: 'width'; range: Range; road?: number; offroadL?: number; offroadR?: number; ease?: number }
    | {
          kind: 'walls';
          range: Range;
          left?: boolean;
          right?: boolean;
          /**
           * Fall-boundary band outside the open edges: true (default: up to 6000 wide, 1000 below),
           * false (none), or a custom band, e.g. deep and narrow in the gap above a lower road so
           * karts that clear the gap land on that road.
           */
          fall?: boolean | { depth: number; width: number };
          /**
           * Invisible wall height above the walls here (default: the cross-section's), e.g. taller
           * beside a jump; per side as `{ left?, right? }`.
           */
          invisibleWallH?: number | { left?: number; right?: number };
          /**
           * Slick walls: the barriers and invisible walls here (air room included) are KCL 0x0F, which
           * the engine treats like 0x0C except that a kart against it keeps 70% of its speed limit
           * instead of 40%. Beside a jump's ramp and flight, so a kart grinding the barrier up the
           * ramp, or brushing a wall in the air, still clears the gap.
           */
          slick?: boolean;
      }
    | { kind: 'dashPanel'; span: Span; lat?: Lat }
    | { kind: 'jumpPad'; span: Span; variant: number; lat?: Lat }
    | { kind: 'surface'; range: Range; attr: number; lat?: Lat; label?: string }
    | {
          kind: 'ramp';
          range: Range;
          /** Lip height above the road. */
          height: number;
          /** KCL attribute of the ramp surface (default: boost ramp variant 1, trickable road otherwise). */
          attr?: number;
          lat?: Lat;
          /** Profile exponent (height * t^exp); 2 = constant curvature-ish kicker. */
          exp?: number;
      }
    | { kind: 'gap'; range: Range; lat?: Lat; depth?: number }
    | { kind: 'shortcut'; range: Range; side: 'left' | 'right'; attr?: number; wallH?: number; label?: string }
    | { kind: 'island'; range: Range; half: number; ease?: number; wallH?: number; attr?: number; respawnLane: 'left' | 'right' }
    | {
          /**
           * Barrel cannon: a trigger (KCL 0x11) across the road at the start of the range, no floor
           * after it, and a CNPT at `target` (a centerline point at height `y`) aimed along the
           * centerline. The kart flies in a straight line (plus the parameter's arc) from the
           * trigger to the target, then continues ballistically; the road resumes at the range end.
           * Checkpoints skip the flight (one long checkpoint quad).
           */
          kind: 'cannon';
          range: Range;
          target: { at: Ref; y: number };
          /** Index into KartMove's cannon parameter table (0: straight, 1: 5000 arc, 2: slow). */
          param?: 0 | 1 | 2;
      }
    | {
          /**
           * Room in the air beside a jump's flight: the invisible wall on one side stands `out` further
           * out, straight up from the barrier's top (widening over `easeIn` from the range start and
           * back in over `easeOut` to its end), so a kart that takes off along the barrier line, tricks
           * there or drifts toward it doesn't brush it: a mid-air wall hit keeps 40% of the speed and
           * points the kart along its body, which mid-trick can face anywhere. `above` (default: the
           * barrier's top) lifts the room's floor, e.g. over a median, so it clears karts on the road
           * beyond. The room's floor slopes up from the barrier line to the moved-out wall (up to 600
           * above it), so a kart that comes down in the room slides back in over the barrier instead of
           * dropping outside it. Nothing may stand within 300 of the room (another road's invisible
           * walls): KCL faces are 300 thick and push karts through from behind.
           */
          kind: 'airRoom';
          range: Range;
          side: 'left' | 'right';
          out: number;
          above?: number;
          easeIn?: number;
          easeOut?: number;
      }
    | {
          /**
           * Half-pipe on one side: a quarter-pipe (KCL 0x13) replaces the offroad strip, curving
           * from the road edge up to vertical (`height`, default 700), topped by an invisible
           * half-pipe wall (0x1C). Karts that ride up and leave the lip fly straight up along it
           * and land back in the pipe (trick → boost).
           */
          kind: 'halfpipe';
          range: Range;
          side: 'left' | 'right';
          height?: number;
          /** Invisible wall height above the lip (default 4000). */
          wallH?: number;
          /**
           * Run-in at each end (default 0): the pipe rises from a kerb-sized lip (4% of `height`) to
           * its full height over this length (smoothstep), so it grows out of the barrier line instead
           * of starting as a full-height slab.
           */
          ease?: number;
      };

export type TrackDef = {
    id: string;
    name: string;
    description: string;
    laps: number;
    theme: Theme;
    /** Suggested ground plane height for the renderer (null: no ground, e.g. floating courses). */
    groundY?: number | null;
    program?: SegDef[];
    /** Two (non-parallel) straights whose lengths are solved so the loop closes. */
    closure?: [string, string];
    /**
     * Instead of a turtle program: an explicit closed centerline (world x, z; ~uniformly spaced,
     * smooth, e.g. real streets with filleted corners). `sections` name the stretches starting at a
     * point index; they play the role of segment names in refs and ranges.
     */
    path?: { pts: [number, number][]; sections: { name: string; at: number }[] };
    /** Base elevation of the start of the program (spline S = 0). */
    baseY?: number;
    /**
     * Elevation knots (road height at a ref), interpolated with a periodic monotone cubic; replaces
     * `baseY` as the base profile (bumps / rises still add on top), e.g. a road following real terrain.
     */
    profile?: { at: Ref; y: number }[];
    /** World position (x, z) of the program start (default 0, 0). The program starts heading +Z. */
    origin?: [number, number];
    crossSection: CrossSection;
    /** Finish line position. */
    finish: Ref;
    /** Start point (KTPT) distance behind the finish line. */
    spawnBehind?: number;
    zones: Zone[];
    checkpoints?: {
        spacing?: number; // default 2500
        maxTurnDeg?: number; // default 20
        keyCount?: number; // default 4 (incl. finish line)
        margin?: number; // default 300: distance past the walls
        openMargin?: number; // default 1500: distance past an edge without wall
        jugemEvery?: number; // default 3
        /** Ranges that may not hold key checkpoints (e.g. sections a cliff drop skips). */
        noKey?: Range[];
        /**
         * Default 8000: stretches of road this close (edge to edge) that the lap reaches much later
         * get a key checkpoint between them, so crossing from one to the other doesn't count.
         */
        shortcutGap?: number;
    };
    /** Extra fields copied into course_meta.json (renderer/app data, e.g. section titles). */
    extra?: Record<string, unknown>;
    /**
     * Station spacing: at most `max` units apart (default 500), `deg` degrees of turning (default 3).
     * `dense`: ranges with a tighter `max`, e.g. the run-in to a corner off a long straight, where a
     * `max`-long chord reaches into the bend and the edges kink at its end.
     */
    stations?: { max?: number; deg?: number; dense?: { range: Range; max: number }[] };
    validate?: {
        maxGrade?: number; // default 0.08
        minClearance?: number; // default 1000
        /** Roads further apart vertically than this may overlap in plan (default 2500). */
        vertSep?: number;
        /** Expected total turning in degrees: ±360 for a simple loop, 0 for a figure eight (default ±360). */
        turning?: number;
    };
};
