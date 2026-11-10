import { IconBase, type IconBaseProps } from "react-icons";

/** Structural subset of a Font Awesome definition; no Font Awesome runtime needed. */
export interface CustomIconDefinition {
  readonly prefix: string;
  readonly iconName: string;
  readonly icon: readonly [
    width: number,
    height: number,
    ligatures: readonly (string | number)[],
    unicode: string,
    paths: string | readonly string[],
  ];
}

/** Custom paths share the size, color, title and context of react-icons icons. */
export function customIcon(definition: CustomIconDefinition) {
  const [width, height, , , data] = definition.icon;
  const paths = typeof data === "string" ? [data] : data;
  return function CustomIcon(props: IconBaseProps) {
    return (
      <IconBase
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden={
          props.title || props["aria-label"] || props["aria-labelledby"] ? undefined : true
        }
        focusable="false"
        {...props}
      >
        {paths.map((d, index) => (
          <path key={index} d={d} />
        ))}
      </IconBase>
    );
  };
}
