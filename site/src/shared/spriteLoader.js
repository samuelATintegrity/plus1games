// spriteLoader.js — loads SVG files as HTMLImageElement objects for canvas drawImage().
//
// Usage:
//   import playerUrl from './assets/player.svg';
//   const sprites = await loadSprites({ player: playerUrl });
//   ctx.drawImage(sprites.player, x, y, w, h);

/**
 * Load a single SVG URL into an HTMLImageElement.
 * @param {string} url - Vite-resolved asset URL
 * @returns {Promise<HTMLImageElement>}
 */
export function loadSprite(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load sprite: ${url}`));
    img.src = url;
  });
}

/**
 * Load a map of { key: url } into { key: HTMLImageElement }.
 * All images load in parallel.
 * @param {Record<string, string>} urlMap
 * @returns {Promise<Record<string, HTMLImageElement>>}
 */
export async function loadSprites(urlMap) {
  const keys = Object.keys(urlMap);
  const images = await Promise.all(keys.map((k) => loadSprite(urlMap[k])));
  const result = {};
  for (let i = 0; i < keys.length; i++) {
    result[keys[i]] = images[i];
  }
  return result;
}

/**
 * Create a team-colored variant of an SVG.
 * Fetches the SVG text, replaces CSS custom property defaults, returns a new Image.
 *
 * SVGs should use:
 *   fill="var(--team-fill, #defaultFill)"
 *   stroke="var(--team-stroke, #defaultStroke)"
 *
 * @param {string} url - SVG URL to fetch
 * @param {{ fill: string, stroke: string }} colors - team colors
 * @returns {Promise<HTMLImageElement>}
 */
export async function createTeamVariant(url, colors) {
  const resp = await fetch(url);
  let svgText = await resp.text();

  // Inject a <style> element that sets the custom properties
  const style = `<style>:root { --team-fill: ${colors.fill}; --team-stroke: ${colors.stroke}; }</style>`;
  svgText = svgText.replace(/<svg([^>]*)>/, `<svg$1>${style}`);

  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const blobUrl = URL.createObjectURL(blob);
  const img = await loadSprite(blobUrl);
  URL.revokeObjectURL(blobUrl);
  return img;
}
