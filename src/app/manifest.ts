import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "PMK-NEXUS",
    short_name: "NEXUS",
    description: "Sistem administrasi dan operasional PMK ITERA",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F7F3EA",
    theme_color: "#5C3A21",
    icons: [
      {
        src: "/brand/pmk-logo-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/pmk-logo.png",
        sizes: "400x400",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/pmk-logo-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
