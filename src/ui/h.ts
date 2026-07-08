/**
 * Typed DOM builder — replaces innerHTML templating for anything that carries
 * remote/user data. Text goes through textContent, so there is no XSS surface.
 */

type Child = Node | string | null | undefined | false;

export interface Props {
  className?: string;
  id?: string;
  role?: string;
  tabIndex?: number;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  src?: string;
  alt?: string;
  href?: string;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  style?: string;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { dataset, attrs, on, style, ...rest } = props;
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    (el as unknown as Record<string, unknown>)[k] = v;
  }
  if (style) el.setAttribute('style', style);
  if (dataset) for (const [k, v] of Object.entries(dataset)) el.dataset[k] = v;
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (on) {
    for (const [ev, fn] of Object.entries(on)) {
      el.addEventListener(ev, fn as EventListener);
    }
  }
  append(el, children);
  return el;
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

/** SVG <use> icon referencing the sprite. */
export function icon(name: string, extraClass = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', ('icon ' + extraClass).trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#' + name);
  svg.appendChild(use);
  return svg;
}
