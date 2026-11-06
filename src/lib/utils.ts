import { createCn } from "cn/config";

// The Stitch type scale (`--text-*` in src/app/globals.css) uses custom names. Without this list,
// cn() treats e.g. `text-label-lg` as a text COLOR and drops it when a real color class follows
// (`cn("text-label-lg text-walnut")` -> "text-walnut"). Keep in sync with the `--text-*` tokens.
const STITCH_TEXT_SIZES = [
  "display-lg",
  "display-sm",
  "headline-lg",
  "headline-sm",
  "body-lg",
  "body-md",
  "body-sm",
  "label-lg",
  "label-sm",
  "numeric-metric",
  "field",
];

export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: STITCH_TEXT_SIZES }] } },
});
