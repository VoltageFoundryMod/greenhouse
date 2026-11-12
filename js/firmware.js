// @ts-check
// Firmware versions and the latest release on GitHub, for greenhouse's update
// helper. Each device whose firmware publishes releases is a product here:
// the prefix of the version it reports, its repo, and how its release
// assets are named (the UF2s from its release build, one per board).

/**
 * @typedef {object} Product
 * @property {string} name what greenhouse calls it
 * @property {string[]} prefixes its versions: "<prefix>-X.Y.Z" (a renamed product keeps its old prefix)
 * @property {string} repo "owner/name" on GitHub
 * @property {RegExp} asset a release asset: (1) the version, (2) the board
 * @property {string} [fixedLayout] first version with the files at a fixed place in flash
 */

/** @type {Product[]} */
export const PRODUCTS = [
    {
        name: 'parterre',
        // parterre-X.Y.Z since 0.4.0, og-X.Y.Z (Open Grid) before
        prefixes: ['parterre', 'og'],
        repo: 'VoltageFoundryMod/parterre',
        // parterre-0.4.0-rp2040_zero.uf2; before 0.4, iii-open-grid-og-0.3.16-rp2040_zero.uf2
        asset: /^(?:iii-open-grid-)?((?:parterre|og)-\d+\.\d+\.\d+)-([a-z0-9_]+)\.uf2$/,
        // og-0.3.7 moved the files to a fixed place in flash; coming from an
        // older version they have to be restored once after updating
        fixedLayout: 'og-0.3.7'
    },
    {
        name: 'achene',
        prefixes: ['ach'],
        repo: 'VoltageFoundryMod/achene',
        asset: /^achene-(ach-\d+\.\d+\.\d+)-([a-z0-9_]+)\.uf2$/
    }
];

/** @param {Product} product */
export const releasesPage = (product) => `https://github.com/${product.repo}/releases`;

/**
 * The product a version belongs to ("parterre-0.4.0" and "og-0.3.6" ->
 * parterre, "ach-0.0.5" -> achene); null for others (stock iii reports e.g.
 * "v260324").
 * @param {string | null | undefined} version
 * @returns {Product | null}
 */
export function productOf(version) {
    const prefix = String(version || '').match(/^([a-z]+)-\d+\.\d+\.\d+/)?.[1];
    return PRODUCTS.find((p) => prefix !== undefined && p.prefixes.includes(prefix)) || null;
}

/**
 * "og-0.3.6" (also "og-0.3.6-200mhz"), "ach-0.0.5" -> [0, 3, 6]...; null when
 * it isn't a version of a product above.
 * @param {string | null | undefined} version
 * @returns {number[] | null}
 */
export function parseVersion(version) {
    if (!productOf(version)) return null;
    const match = String(version).match(/^[a-z]+-(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1, 4).map(Number) : null;
}

/**
 * Whether `latest` is newer than `current` (both versions of one product).
 * @param {string} latest
 * @param {string | null | undefined} current
 */
export function isNewer(latest, current) {
    const a = parseVersion(latest);
    const b = parseVersion(current);
    if (!a || !b || productOf(latest) !== productOf(current)) return false;
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}

/**
 * @typedef {object} Release
 * @property {string} version e.g. "og-0.3.6"
 * @property {string} page the release's web page (notes)
 * @property {Record<string, string>} uf2 board -> download URL
 */

/**
 * Reads a GitHub release (API JSON) into what greenhouse needs.
 * @param {{ tag_name?: string, html_url?: string, assets?: { name: string, browser_download_url: string }[] }} json
 * @param {Product} [product] parterre when left out
 * @returns {Release | null}
 */
export function parseRelease(json, product = PRODUCTS[0]) {
    /** @type {Record<string, string>} */
    const uf2 = {};
    const tag = String(json.tag_name || '');
    let version = productOf(tag) === product ? tag.match(/^[a-z]+-\d+\.\d+\.\d+/)?.[0] || '' : '';
    for (const asset of json.assets || []) {
        const match = asset.name.match(product.asset);
        if (!match) continue;
        uf2[match[2]] = asset.browser_download_url;
        version ||= match[1];
    }
    if (!version || !Object.keys(uf2).length) return null;
    return { version, page: json.html_url || releasesPage(product), uf2 };
}

/**
 * The product's latest release, or null when there is none (or it has no
 * UF2s, or the repo isn't public yet). Throws when GitHub can't be reached
 * (offline).
 * @param {Product} [product] parterre when left out
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<Release | null>}
 */
export async function fetchLatestRelease(product = PRODUCTS[0], fetchFn = fetch) {
    // The list, not /releases/latest: with no release yet, /latest answers
    // 404, which the browser logs as an error; the list is just empty.
    const api = `https://api.github.com/repos/${product.repo}/releases?per_page=10`;
    const response = await fetchFn(api, { headers: { Accept: 'application/vnd.github+json' } });
    if (response.status === 404) return null; // a private repo looks like none
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const list = await response.json();
    if (!Array.isArray(list)) return null;
    // newest first; skip drafts and pre-releases, and releases without UF2s
    for (const json of list) {
        if (json.draft || json.prerelease) continue;
        const release = parseRelease(json, product);
        if (release) return release;
    }
    return null;
}
