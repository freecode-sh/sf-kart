/**
 * A mutable holder used to port C++ primitive out-parameters (`f32 &`, `u16 *`, `KCLTypeMask *`).
 * The caller creates the box, passes it (or `null` for a nullable pointer), and reads `.value`.
 */
export interface Box<T> {
    value: T;
}

export function box<T>(value: T): Box<T> {
    return { value };
}
