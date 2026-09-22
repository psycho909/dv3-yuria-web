export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function randomIntInclusive(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
}
export function pickOne(rng, items) {
    if (items.length === 0)
        throw new Error("Cannot pick from an empty list");
    return items[Math.floor(rng() * items.length)];
}
