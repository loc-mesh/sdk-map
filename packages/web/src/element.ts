/**
 * `<mesh-map>` — the same control as a custom element.
 *
 * ⚠️ A CUSTOM ELEMENT RATHER THAN A REACT COMPONENT, DELIBERATELY. Custom
 * elements work unchanged in React, Vue, Angular, Svelte and a plain HTML file.
 * A React component would have been the easier thing to write and would have
 * made every other framework a second-class citizen — which is the wrong bet
 * for a platform whose customers we have never met.
 *
 * Importing this module registers the element. That is a side effect, declared
 * as one in package.json so a bundler does not tree-shake it away.
 */

import { MeshMap, type MeshMapOptions } from './map.js';
import type { Theme } from './theme.js';

const NUMBER_ATTRS = ['zoom', 'pitch', 'bearing'] as const;

export class MeshMapElement extends HTMLElement {
  /** The control, once it has finished starting. Null before that and after disconnect. */
  controller: MeshMap | null = null;
  private starting: Promise<void> | null = null;

  static get observedAttributes(): string[] {
    return ['theme'];
  }

  connectedCallback(): void {
    // The element has no height of its own; without this the map renders into a
    // zero-pixel box and the page looks empty with nothing reporting a problem.
    if (!this.style.display) this.style.display = 'block';
    this.starting = this.start();
  }

  disconnectedCallback(): void {
    this.controller?.destroy();
    this.controller = null;
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === 'theme' && value && this.controller) void this.controller.setTheme(value as Theme);
  }

  private async start(): Promise<void> {
    const attr = (n: string) => this.getAttribute(n) ?? undefined;
    const centre = attr('center')?.split(',').map(Number);

    const options: MeshMapOptions = {
      container: this,
      tilesBaseUrl: attr('tiles-base-url') ?? '',
      mapKey: attr('map-key'),
      theme: attr('theme') as Theme | undefined,
      autoTheme: this.hasAttribute('auto-theme'),
      pois: attr('pois') !== 'false',
      buildings3d: attr('buildings-3d') === 'true',
      region: attr('region'),
      onError: (error) => {
        // Reported as a DOM event as well as the callback, because an element
        // used declaratively has nowhere to put a callback.
        this.dispatchEvent(new CustomEvent('mesh-map-error', { detail: error, bubbles: true }));
        if (error.fatal) console.error(`[mesh-map] ${error.code}: ${error.message}`);
      },
    };
    if (centre?.length === 2 && centre.every((n) => Number.isFinite(n))) {
      options.center = [centre[0]!, centre[1]!];
    }
    for (const n of NUMBER_ATTRS) {
      const v = Number(attr(n));
      if (Number.isFinite(v) && attr(n) !== undefined) (options as unknown as Record<string, unknown>)[n] = v;
    }

    try {
      this.controller = await MeshMap.create(options);
      this.dispatchEvent(new CustomEvent('mesh-map-ready', { detail: this.controller, bubbles: true }));
    } catch {
      // MeshMap.create already reported through onError above; swallowing here
      // keeps an unhandled rejection out of the host application's console.
    }
  }

  /** Resolves once the map has started, so tests and callers can await it. */
  whenReady(): Promise<void> {
    return this.starting ?? Promise.resolve();
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('mesh-map')) {
  customElements.define('mesh-map', MeshMapElement);
}
