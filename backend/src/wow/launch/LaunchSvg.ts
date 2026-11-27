/** A deliberately small XML/SVG grammar. No CSS, entities, namespaces other
 * than SVG, text nodes, links or embedded content are supported. It validates
 * structure before the original bytes are ever rendered as an image. */
export function isLaunchSvg(bytes: Uint8Array): boolean {
  if (!bytes.length || bytes.length > 256 * 1024) return false;
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  if (/[^\x09\x0a\x0d\x20-\x7e]|[&!?]/.test(xml)) return false;
  const elements = new Set([
    "svg",
    "g",
    "path",
    "defs",
    "clipPath",
    "rect",
    "circle",
    "ellipse",
    "polygon",
    "polyline",
    "line",
    "linearGradient",
    "radialGradient",
    "stop",
  ]);
  const attributes = new Set([
    "xmlns",
    "width",
    "height",
    "viewBox",
    "fill",
    "fill-rule",
    "clip-rule",
    "clip-path",
    "id",
    "d",
    "x",
    "y",
    "x1",
    "x2",
    "y1",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "points",
    "transform",
    "opacity",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "fx",
    "fy",
  ]);
  const stack: string[] = [];
  let root = false;
  let position = 0;
  let nodes = 0;
  while (position < xml.length) {
    const whitespace = /^\s*/.exec(xml.slice(position))![0];
    position += whitespace.length;
    if (position === xml.length) break;
    const tag =
      /^<(\/)?([A-Za-z]+)((?:\s+[A-Za-z][A-Za-z0-9-]*\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*)\s*(\/?)>/.exec(
        xml.slice(position),
      );
    if (!tag || ++nodes > 4096) return false;
    position += tag[0].length;
    const [, closing, name, attrs, selfClosing] = tag;
    if (!elements.has(name!)) return false;
    if (closing) {
      if (attrs!.trim() || selfClosing || stack.pop() !== name) return false;
      continue;
    }
    if (!stack.length) {
      if (root || name !== "svg") return false;
      root = true;
    }
    if (name === "svg" && stack.length) return false;
    const seen = new Set<string>();
    for (const attr of attrs!.matchAll(
      /([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/g,
    )) {
      const key = attr[1]!;
      const value = attr[2] ?? attr[3]!;
      if (!attributes.has(key) || seen.has(key)) return false;
      seen.add(key);
      if (key === "xmlns") {
        if (name !== "svg" || value !== "http://www.w3.org/2000/svg") return false;
      } else if (
        key === "fill" ||
        key === "stroke" ||
        key === "clip-path" ||
        key === "stop-color"
      ) {
        if (!/^(?:none|[A-Za-z]+|#[a-fA-F0-9]{3,8}|url\(#[A-Za-z_][A-Za-z0-9_-]*\))$/.test(value))
          return false;
      } else if (!/^[A-Za-z0-9_.,+%()\s-]*$/.test(value)) return false;
    }
    if (name === "svg" && !seen.has("xmlns")) return false;
    if (!selfClosing) stack.push(name!);
    if (stack.length > 64) return false;
  }
  return root && stack.length === 0;
}
