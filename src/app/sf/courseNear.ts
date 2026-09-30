/**
 * "Is (x, z) within r of the course?" for scenery that's only worth building near the road: the
 * centerline's segments bucketed in an r-sized grid, so a test looks at one cell's few segments.
 */

export function nearCourse(centerline: readonly { pos: readonly number[] }[], r: number): (x: number, z: number) => boolean {
    const grid = new Map<string, number[]>();
    const n = centerline.length;
    for (let i = 0; i < n; ++i) {
        const a = centerline[i]!.pos;
        const b = centerline[(i + 1) % n]!.pos;
        const i0 = Math.floor((Math.min(a[0]!, b[0]!) - r) / r);
        const i1 = Math.floor((Math.max(a[0]!, b[0]!) + r) / r);
        const j0 = Math.floor((Math.min(a[2]!, b[2]!) - r) / r);
        const j1 = Math.floor((Math.max(a[2]!, b[2]!) + r) / r);
        for (let gi = i0; gi <= i1; ++gi)
            for (let gj = j0; gj <= j1; ++gj) {
                const key = `${gi},${gj}`;
                let list = grid.get(key);
                if (!list) grid.set(key, (list = []));
                list.push(i);
            }
    }
    const r2 = r * r;
    return (x, z) => {
        const list = grid.get(`${Math.floor(x / r)},${Math.floor(z / r)}`);
        if (!list) return false;
        for (const i of list) {
            const a = centerline[i]!.pos;
            const b = centerline[(i + 1) % n]!.pos;
            const ex = b[0]! - a[0]!;
            const ez = b[2]! - a[2]!;
            const L2 = ex * ex + ez * ez;
            const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]!) * ex + (z - a[2]!) * ez) / L2)) : 0;
            if ((x - a[0]! - ex * t) ** 2 + (z - a[2]! - ez * t) ** 2 < r2) return true;
        }
        return false;
    };
}
