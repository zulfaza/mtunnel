import type { ComponentType } from "react";
import ogHtml from "../../api/scripts/og.html?raw";
import templateDimensions from "./template-dimensions.json";

type TemplateBase = {
  id: string;
  name: string;
  width: number;
  height: number;
};

export type AssetTemplate =
  | (TemplateBase & { kind: "react"; Component: ComponentType })
  | (TemplateBase & { kind: "html"; markup: string });

function AnnouncementImage() {
  return (
    <main className="announcement-image">
      <section>
        <small>mTunnel update</small>
        <h1>Share local work with one command.</h1>
        <p>Fast, private tunnels for development teams.</p>
      </section>
    </main>
  );
}

export const templates: readonly AssetTemplate[] = [
  {
    id: "og",
    name: "Landing OG",
    ...templateDimensions.og,
    kind: "html",
    markup: ogHtml,
  },
  {
    id: "dashboard-og",
    name: "Dashboard OG",
    ...templateDimensions["dashboard-og"],
    kind: "html",
    markup: ogHtml.replace("makarima.xyz", "app.makarima.xyz"),
  },
  {
    id: "announcement",
    name: "Announcement",
    ...templateDimensions.announcement,
    kind: "react",
    Component: AnnouncementImage,
  },
];

export function findTemplate(id: string | null): AssetTemplate | undefined {
  return templates.find((template) => template.id === id);
}
