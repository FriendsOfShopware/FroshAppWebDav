export function hasCacheKey(shop: string, key: string ) {
    // @ts-ignore
    if (typeof globalThis.cache === 'undefined') {
        // @ts-ignore
        globalThis.cache = {};
    }

    // @ts-ignore
    if (typeof globalThis.cache[shop] === 'undefined') {
        // @ts-ignore
        globalThis.cache[shop] = {};
    }

    // @ts-ignore
    return globalThis.cache[shop].hasOwnProperty(key);
}

export function getCacheKey(shop: string, key: string ) {
    // prepares the object for us
    hasCacheKey(shop, key);

    // @ts-ignore
    return globalThis.cache[shop][key] || null;
}

export function setCacheKey(shop: string, key: string, value: any) {
    // prepares the object for us
    hasCacheKey(shop, key);

    // @ts-ignore
    globalThis.cache[shop][key] = value;
}

export function removeCacheKey(shop: string, key: string ) {
    if (hasCacheKey(shop, key)) {
        // @ts-ignore
        delete globalThis.cache[shop][key];
    }
}