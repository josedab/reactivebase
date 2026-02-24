/**
 * Embeddable Playground Widget — Generates iframe-friendly HTML and embed scripts
 * for embedding ReactiveBase playgrounds in documentation, blogs, and other sites.
 *
 * Usage:
 *   const html = generateEmbeddableWidgetHTML({ width: "100%", height: "500px" })
 *   const script = generateEmbedScript({ width: "100%", height: "500px" })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlaygroundWidget {
  width?: string
  height?: string
  theme?: "light" | "dark"
  initialSchema?: string
  initialQuery?: string
}

// ─── Widget HTML Generation ──────────────────────────────────────────────────

export function generateEmbeddableWidgetHTML(config: PlaygroundWidget = {}): string {
  const { width = "100%", height = "400px", theme = "dark", initialSchema = "", initialQuery = "" } = config

  const bgColor = theme === "dark" ? "#1e1e2e" : "#ffffff"
  const fgColor = theme === "dark" ? "#cdd6f4" : "#1e1e2e"
  const borderColor = theme === "dark" ? "#45475a" : "#ddd"

  const escapedSchema = escapeHTML(initialSchema)
  const escapedQuery = escapeHTML(initialQuery)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ReactiveBase Playground</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'SF Mono', 'Fira Code', monospace; background: ${bgColor}; color: ${fgColor}; width: ${width}; height: ${height}; overflow: hidden; }
    .widget-container { display: flex; flex-direction: column; height: 100%; border: 1px solid ${borderColor}; border-radius: 8px; overflow: hidden; }
    .widget-header { padding: 8px 12px; background: ${theme === "dark" ? "#313244" : "#f5f5f5"}; font-size: 12px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
    .widget-body { display: flex; flex: 1; overflow: hidden; }
    .editor-pane { flex: 1; display: flex; flex-direction: column; border-right: 1px solid ${borderColor}; }
    .output-pane { flex: 1; display: flex; flex-direction: column; }
    .pane-label { padding: 4px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid ${borderColor}; }
    textarea { flex: 1; background: transparent; color: ${fgColor}; border: none; padding: 8px; font-family: inherit; font-size: 13px; resize: none; outline: none; }
    .output { flex: 1; padding: 8px; font-size: 13px; white-space: pre-wrap; overflow: auto; }
    .run-btn { padding: 4px 12px; background: #89b4fa; color: #1e1e2e; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600; }
    .run-btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="widget-container">
    <div class="widget-header">
      <span>ReactiveBase Playground</span>
      <button class="run-btn" onclick="runCode()">Run ▶</button>
    </div>
    <div class="widget-body">
      <div class="editor-pane">
        <div class="pane-label">Code</div>
        <textarea id="code-input">${escapedSchema || escapedQuery}</textarea>
      </div>
      <div class="output-pane">
        <div class="pane-label">Output</div>
        <div class="output" id="output">Click "Run" to execute...</div>
      </div>
    </div>
  </div>
  <script>
    function runCode() {
      const code = document.getElementById('code-input').value;
      const output = document.getElementById('output');
      output.textContent = 'Executing...';
      fetch('/api/playground/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
        .then(r => r.json())
        .then(data => { output.textContent = JSON.stringify(data, null, 2); })
        .catch(err => { output.textContent = 'Error: ' + err.message; });
    }
  </script>
</body>
</html>`
}

// ─── Embed Script Generation ─────────────────────────────────────────────────

export function generateEmbedScript(config: PlaygroundWidget = {}): string {
  const { width = "100%", height = "400px", theme = "dark", initialSchema = "", initialQuery = "" } = config

  const encodedConfig = encodeURIComponent(JSON.stringify({ theme, initialSchema, initialQuery }))

  return `<script>
(function() {
  var container = document.currentScript.parentElement;
  var iframe = document.createElement('iframe');
  iframe.style.width = '${width}';
  iframe.style.height = '${height}';
  iframe.style.border = 'none';
  iframe.style.borderRadius = '8px';
  iframe.src = 'https://playground.reactivebase.dev/embed?config=${encodedConfig}';
  container.appendChild(iframe);
})();
</script>`
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHTML(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
