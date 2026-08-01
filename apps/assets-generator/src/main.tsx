import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { findTemplate, templates, type AssetTemplate } from "./templates";
import "./styles.css";

function Asset({ template }: { template: AssetTemplate }) {
  if (template.kind === "html") {
    return <iframe className="html-template" srcDoc={template.markup} title={template.name} />;
  }

  return <template.Component />;
}

function Preview({ template }: { template: AssetTemplate }) {
  const previewReference = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const preview = previewReference.current;
    if (!preview) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / template.width);
    });
    observer.observe(preview);
    return () => observer.disconnect();
  }, [template.width]);

  return (
    <div
      className="preview"
      ref={previewReference}
      style={{ aspectRatio: `${template.width} / ${template.height}` }}
    >
      <div
        style={{
          width: template.width,
          height: template.height,
          transform: `scale(${scale})`,
        }}
      >
        <Asset template={template} />
      </div>
    </div>
  );
}

function Studio() {
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? "");
  const selectedTemplate = findTemplate(selectedId);

  return (
    <main className="studio">
      <header>
        <div>
          <span className="product">mTunnel tools</span>
          <h1>Asset generator</h1>
        </div>
        <code>
          pnpm --filter @tunnel/assets-generator generate -- --template {selectedId || "og"}
        </code>
      </header>
      <div className="workspace">
        <aside>
          <h2>Templates</h2>
          {templates.map((template) => (
            <button
              className={template.id === selectedId ? "selected" : undefined}
              key={template.id}
              onClick={() => setSelectedId(template.id)}
              type="button"
            >
              <span>{template.name}</span>
              <small>
                {template.kind} · {template.width}×{template.height}
              </small>
            </button>
          ))}
        </aside>
        <section className="preview-panel">
          {selectedTemplate ? <Preview template={selectedTemplate} /> : <p>Choose a template.</p>}
        </section>
      </div>
    </main>
  );
}

const parameters = new URLSearchParams(window.location.search);
const renderTemplate = findTemplate(parameters.get("render"));
const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <StrictMode>{renderTemplate ? <Asset template={renderTemplate} /> : <Studio />}</StrictMode>,
  );
}
