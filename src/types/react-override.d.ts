import "react";

declare module "react" {
  interface CSSProperties {
    width?: string | number;
    height?: string | number;
    [key: string]: unknown;
  }
}
