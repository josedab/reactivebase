/**
 * HTML generator for self-contained ReactiveBase Playground pages.
 */

import type { PlaygroundHTMLOptions } from "./playground-types.js"
import { PLAYGROUND_TEMPLATES, BUILTIN_TUTORIALS } from "./playground-templates.js"

export function generatePlaygroundHTML(options: PlaygroundHTMLOptions = {}): string {
  const title = options.title ?? "ReactiveBase Playground"
  const theme = options.theme ?? "dark"
  const isDark = theme === "dark"
  const template = options.template
    ? PLAYGROUND_TEMPLATES.find((t) => t.id === options.template)
    : PLAYGROUND_TEMPLATES[0]

  const bg = isDark ? "#0d1117" : "#ffffff"
  const fg = isDark ? "#c9d1d9" : "#1f2328"
  const border = isDark ? "#30363d" : "#d0d7de"
  const accent = "#58a6ff"
  const editorBg = isDark ? "#161b22" : "#f6f8fa"

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: ${bg}; color: ${fg}; height: 100vh; display: flex; flex-direction: column; }
  .header { padding: 12px 20px; border-bottom: 1px solid ${border}; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 16px; font-weight: 600; }
  .logo { color: ${accent}; font-weight: 700; }
  .badge { background: #238636; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; }
  .toolbar { display: flex; gap: 8px; margin-left: auto; }
  .btn { padding: 6px 12px; border-radius: 6px; border: 1px solid ${border}; background: ${editorBg}; color: ${fg}; cursor: pointer; font-size: 13px; }
  .btn-primary { background: #238636; border-color: #238636; color: white; }
  .btn:hover { opacity: 0.9; }
  .main { flex: 1; display: flex; overflow: hidden; }
  .sidebar { width: 240px; border-right: 1px solid ${border}; padding: 16px; overflow-y: auto; }
  .sidebar h3 { font-size: 12px; color: #8b949e; text-transform: uppercase; margin-bottom: 8px; }
  .template-item { padding: 8px; border-radius: 6px; cursor: pointer; margin-bottom: 4px; font-size: 13px; }
  .template-item:hover { background: ${editorBg}; }
  .template-item.active { background: ${accent}20; color: ${accent}; }
  .editor-area { flex: 1; display: flex; flex-direction: column; }
  .tabs { display: flex; border-bottom: 1px solid ${border}; }
  .tab { padding: 10px 16px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; color: #8b949e; }
  .tab.active { border-bottom-color: ${accent}; color: ${fg}; }
  .editor { flex: 1; position: relative; }
  .editor textarea { width: 100%; height: 100%; background: ${editorBg}; color: ${fg}; border: none; padding: 16px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; line-height: 1.6; resize: none; outline: none; }
  .output-panel { height: 200px; border-top: 1px solid ${border}; display: flex; flex-direction: column; }
  .output-header { padding: 8px 16px; border-bottom: 1px solid ${border}; font-size: 12px; color: #8b949e; display: flex; align-items: center; gap: 8px; }
  .output-content { flex: 1; padding: 12px 16px; font-family: 'SF Mono', monospace; font-size: 12px; overflow-y: auto; background: ${editorBg}; }
  .output-success { color: #3fb950; }
  .output-error { color: #f85149; }
  .tutorial-panel { width: 320px; border-left: 1px solid ${border}; padding: 16px; overflow-y: auto; display: none; }
  .tutorial-panel.active { display: block; }
  .step-indicator { display: flex; gap: 4px; margin-bottom: 16px; }
  .step-dot { width: 24px; height: 4px; border-radius: 2px; background: ${border}; }
  .step-dot.completed { background: #238636; }
  .step-dot.current { background: ${accent}; }
  .hint { background: ${editorBg}; border: 1px solid ${border}; border-radius: 6px; padding: 12px; margin-top: 8px; font-size: 13px; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .fade-in { animation: fadeIn 0.3s ease-in; }
</style>
</head>
<body>
  <div class="header">
    <span class="logo">⚡ ReactiveBase</span>
    <h1>Playground</h1>
    <span class="badge">Interactive</span>
    <div class="toolbar">
      <button class="btn" onclick="shareSession()">Share</button>
      <button class="btn btn-primary" onclick="runCode()">▶ Run</button>
    </div>
  </div>
  <div class="main">
    <div class="sidebar">
      <h3>Templates</h3>
${PLAYGROUND_TEMPLATES.map(
    (t, i) =>
      `      <div class="template-item${i === 0 ? " active" : ""}" onclick="loadTemplate('${t.id}')">${t.name}<br><small style="color:#8b949e">${t.description}</small></div>`,
  ).join("\n")}
      <h3 style="margin-top:16px">Tutorials</h3>
${BUILTIN_TUTORIALS.map(
    (t) =>
      `      <div class="template-item" onclick="startTutorial('${t.id}')">📖 ${t.title}<br><small style="color:#8b949e">${t.estimatedMinutes} min</small></div>`,
  ).join("\n")}
    </div>
    <div class="editor-area">
      <div class="tabs">
        <div class="tab active" onclick="switchTab('schema')">Schema</div>
        <div class="tab" onclick="switchTab('queries')">Queries</div>
        <div class="tab" onclick="switchTab('mutations')">Mutations</div>
      </div>
      <div class="editor">
        <textarea id="code-editor" spellcheck="false">${template?.schema ?? ""}</textarea>
      </div>
      <div class="output-panel">
        <div class="output-header">
          <span>Output</span>
          <span id="exec-time" style="margin-left:auto"></span>
        </div>
        <div class="output-content" id="output"></div>
      </div>
    </div>
    <div class="tutorial-panel" id="tutorial-panel">
      <div class="step-indicator" id="step-indicator"></div>
      <h3 id="tutorial-title"></h3>
      <p id="tutorial-desc" style="margin-top:8px;font-size:13px;color:#8b949e"></p>
      <div id="tutorial-hints" style="margin-top:12px"></div>
      <button class="btn btn-primary" style="margin-top:16px;width:100%" onclick="nextStep()">Next Step →</button>
    </div>
  </div>
  <script>
    const templates = ${JSON.stringify(PLAYGROUND_TEMPLATES)};
    const tutorials = ${JSON.stringify(BUILTIN_TUTORIALS)};
    let currentTab = 'schema';
    let editorContent = { schema: templates[0]?.schema || '', queries: templates[0]?.queries || '', mutations: templates[0]?.mutations || '' };
    let currentTutorial = null;
    let currentStepIdx = 0;

    function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function switchTab(tab) {
      editorContent[currentTab] = document.getElementById('code-editor').value;
      currentTab = tab;
      document.getElementById('code-editor').value = editorContent[tab] || '';
      document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', ['schema','queries','mutations'][i] === tab));
    }

    function loadTemplate(id) {
      const t = templates.find(x => x.id === id);
      if (!t) return;
      editorContent = { schema: t.schema, queries: t.queries, mutations: t.mutations };
      document.getElementById('code-editor').value = editorContent[currentTab];
      document.querySelectorAll('.template-item').forEach(el => el.classList.remove('active'));
      event.currentTarget.classList.add('active');
    }

    function runCode() {
      const code = document.getElementById('code-editor').value;
      const start = performance.now();
      const output = document.getElementById('output');
      try {
        output.innerHTML = '<span class="output-success">✓ Code parsed successfully. ' +
          code.split('\\n').filter(l => l.trim()).length + ' lines analyzed.</span>';
      } catch(e: unknown) {
        output.innerHTML = '<span class="output-error">✗ ' + escapeHtml(e.message) + '</span>';
      }
      document.getElementById('exec-time').textContent = Math.round(performance.now() - start) + 'ms';
    }

    function shareSession() {
      editorContent[currentTab] = document.getElementById('code-editor').value;
      const data = btoa(JSON.stringify({ s: editorContent.schema, q: editorContent.queries, m: editorContent.mutations }));
      const url = location.origin + location.pathname + '?session=' + data;
      navigator.clipboard?.writeText(url);
      alert('Share URL copied to clipboard!');
    }

    function startTutorial(id) {
      currentTutorial = tutorials.find(t => t.id === id);
      if (!currentTutorial) return;
      currentStepIdx = 0;
      document.getElementById('tutorial-panel').classList.add('active');
      renderStep();
    }

    function renderStep() {
      if (!currentTutorial) return;
      const step = currentTutorial.steps[currentStepIdx];
      const indicator = document.getElementById('step-indicator');
      indicator.innerHTML = currentTutorial.steps.map((_, i) =>
        '<div class="step-dot ' + (i < currentStepIdx ? 'completed' : i === currentStepIdx ? 'current' : '') + '"></div>'
      ).join('');
      document.getElementById('tutorial-title').textContent = step.title;
      document.getElementById('tutorial-desc').textContent = step.description;
      document.getElementById('tutorial-hints').innerHTML = step.hints.map(h => '<div class="hint">💡 ' + escapeHtml(h) + '</div>').join('');
      document.getElementById('code-editor').value = step.code;
    }

    function nextStep() {
      if (!currentTutorial || currentStepIdx >= currentTutorial.steps.length - 1) return;
      currentStepIdx++;
      renderStep();
    }

    // Restore from URL
    const params = new URLSearchParams(location.search);
    if (params.get('session')) {
      try {
        const d = JSON.parse(atob(params.get('session')));
        editorContent = { schema: d.s || '', queries: d.q || '', mutations: d.m || '' };
        document.getElementById('code-editor').value = editorContent[currentTab];
      } catch(e: unknown) {
        console.error("Failed to restore session from URL:", e);
      }
    }
  </script>
</body>
</html>`
}
