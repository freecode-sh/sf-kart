// The math core's trace (src/egg/math): every result, one per line (f32 bits in hex, root counts in
// decimal), for 2000 pseudo-random inputs from a fixed LCG. tests/math.test.ts pins its hash to the
// output of the same sequence run against Kinoko's C++ egg/math, so any change to the math core that
// isn't bit-exact fails the tests. To diff by hand:
//   npx tsx tests/mathTrace.ts > ts.txt
// (the C++ side, the same LCG, draws and calls printed the same way, is not part of this repository).
import { pathToFileURL } from 'node:url';
import { Vector3f } from '../src/egg/math/Vector';
import { Quatf } from '../src/egg/math/Quat';
import { Matrix34f } from '../src/egg/math/Matrix';
import * as M from '../src/egg/math/Math';
const fr = Math.fround;
export function mathTrace(): string[] {
    let s = 12345;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
    const rf = (lo: number, hi: number) => { lo = fr(lo); hi = fr(hi); return fr(lo + fr(fr(hi - lo) * fr((rnd() >>> 8) / 16777216.0))); };
    const out: string[] = [];
    const p = (x: number) => out.push(M.f2u(x).toString(16).padStart(8, '0'));
    const pv = (v: Vector3f) => { p(v.x); p(v.y); p(v.z); };
    const pq = (q: Quatf) => { p(q.w); pv(q.v); };
    for (let i = 0; i < 2000; ++i) {
        const a = rf(0.0001, 5000.0), b = rf(-10.0, 10.0), c = rf(-10.0, 10.0);
        p(M.sqrt(a)); p(M.frsqrt(a)); p(M.fres(b)); p(M.finv(c));
        p(M.sin(b)); p(M.cos(c)); p(M.atan2(b, c));
        const [sn, cs] = M.SinCosFIdx(fr(b * 30.0)); p(sn); p(cs);
        p(M.fma(a, b, c)); p(M.asin(fr(b / 10.0))); p(M.acos(fr(c / 10.0)));
        const vx = rf(-100, 100), vy = rf(-100, 100), vz = rf(-100, 100);
        const v = new Vector3f(vx, vy, vz);
        const wx = rf(-1, 1), wy = rf(-1, 1), wz = rf(-1, 1);
        const w = new Vector3f(wx, wy, wz);
        pv(v.cross(w)); p(v.dot(w)); p(v.ps_dot(w)); p(v.ps_length()); pv(v.ps_normalize());
        const n = v.clone(); p(n.normalise()); pv(n); pv(v.perpInPlane(w, true));
        const q = Quatf.FromRPY3(b, c, rf(-3, 3)); q.normalise(); pq(q);
        pv(q.rotateVector(v)); pv(q.rotateVectorInv(v)); pq(q.mul(Quatf.FromRPY3(c, b, fr(0.3))));
        const r = new Quatf(); r.makeVectorRotation(n, new Vector3f(0, 1, 0)); pq(r);
        pq(q.slerpTo(r, rf(0, 1)));
        const m = new Matrix34f(); m.makeQT(q, v); const m2 = new Matrix34f(); m2.makeRT(w, v);
        const mm = m.multiplyTo(m2); for (let k = 0; k < 3; ++k) for (let j = 0; j < 4; ++j) p(mm.get(k, j));
        pv(m.multVector(w)); pv(m.ps_multVector(w)); pv(m.multVector33(w)); pv(m.ps_multVector33(w));
        pv(m2.calcRPY());
        const inv = new Matrix34f(); m2.inverseTo33(inv); for (let k = 0; k < 3; ++k) for (let j = 0; j < 3; ++j) p(inv.get(k, j));
        const inv2 = new Matrix34f(); if (mm.ps_inverse(inv2)) for (let k = 0; k < 3; ++k) for (let j = 0; j < 4; ++j) p(inv2.get(k, j));
        const [nr, r1, r2] = M.FindRootsQuadratic(a, b, c); out.push(String(nr)); p(r1 ?? 0); p(r2 ?? 0);
        p(M.Hermite(a, b, c, a, rf(0, 1)));
    }
    return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(mathTrace().join('\n'));
