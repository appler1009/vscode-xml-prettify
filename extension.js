// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const xmlFormat = require('xml-formatter');

const hljs = require('highlight.js/lib/core');
hljs.registerLanguage('xml', require('highlight.js/lib/languages/xml'));

const GLOBAL_STATE_WRAP_TOGGLE = 'wrap-toggle';
const GLOBAL_STATE_STICKY_TOGGLE = 'sticky-toggle';
const GLOBAL_STATE_THEME = 'theme';

let panel;
let theme;
let wrap;
let sticky;
let latestXml;
let showBMC = false;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  theme = context.globalState.get(GLOBAL_STATE_THEME, 'default');
  wrap = context.globalState.get(GLOBAL_STATE_WRAP_TOGGLE, false);
  sticky = context.globalState.get(GLOBAL_STATE_STICKY_TOGGLE, true);

  const disposable = vscode.commands.registerCommand('prettyXmlPreview.open', function () {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Beside);
    }
    else {
      panel = createWebviewPanel(context);
      updatePrettifiedXML(context);
    }
  });

  context.subscriptions.push(disposable);

  // listen to the selection change event
  vscode.window.onDidChangeTextEditorSelection(() => {
    if (!panel) {
      return;  // it will prevent the panel to reopen when the selection changes
    }
    updatePrettifiedXML(context);
  }, null, context.subscriptions);
}

// This method is called when your extension is deactivated
function deactivate() { }

const XML_PREPROCESSORS = [
  (input) => input.replace(/\\"/g, '"'),
  (input) => input,
];

function updatePrettifiedXML(context) {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selection = editor.selection;
    let textRaw = editor.document.getText(selection);
    if (!textRaw) {
      textRaw = '';
    }
    const text = textRaw.trim();

    if (!panel) {
      panel = createWebviewPanel(context);
    }

    let done = false;
    for (const preproc of XML_PREPROCESSORS) {
      try {
        if (!text.startsWith('<')) {
          continue;
        }
        const prettifiedXml = xmlFormat(preproc(text), {
          indentation: '  ',
          collapseContent: true,
        });
        if (sticky) {
          latestXml = prettifiedXml;
        }

        panel.webview.html = getWebviewContent(prettifiedXml);
        done = true;  // job done
        break;
      } catch { /* ignore */ }
    }
    if (!done) {
      if (!sticky) {
        latestXml = undefined;
      }
      panel.webview.html = getWebviewContent();
    }
  }
}

function createWebviewPanel(context) {
  showBMC = (Math.random() < 0.6);

  let newPanel = vscode.window.createWebviewPanel(
    'prettyXmlPreview',
    'Pretty XML Preview',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true
    }
  );

  newPanel.onDidDispose(
    () => {
      panel = undefined;
    },
    null,
    context.subscriptions
  );

  newPanel.webview.onDidReceiveMessage(
    message => {
      switch (message.command) {
        case 'themeChanged':
          theme = message.theme;
          context.globalState.update(GLOBAL_STATE_THEME, theme);
          break;
        case 'wrapChanged':
          wrap = message.wrap;
          context.globalState.update(GLOBAL_STATE_WRAP_TOGGLE, wrap);
          break;
        case 'stickyChanged':
          sticky = message.sticky;
          context.globalState.update(GLOBAL_STATE_STICKY_TOGGLE, sticky);
          break;
        case 'logMessage':
          console.log(message.text);
          break;
      }
    },
    undefined,
    context.subscriptions
  );

  return newPanel;
}

function getWebviewContent(content) {
  if (!content) {  // if selection is not a XML
    if (!!latestXml) {  // if there was a sticky content
      content = latestXml;
    }
    else {
      content = '';
    }
  }
  let bmc = `<!-- https://buymeacoffee.com/applerk -->`
  if (showBMC) {
    bmc = `<script data-name="BMC-Widget" data-cfasync="false" src="https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js"
        data-id="applerk" data-description="Support me on Buy me a coffee!" data-message="" data-color="#FF813F" data-position="Right"
        data-x_margin="18" data-y_margin="18"></script>`;
  }
  const themeHtml = getThemesHtml();
  return `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Pretty XML Preview</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${theme}.min.css">
      <style>
        .hljs, .hljs code { background: transparent !important; }
        .hljs { counter-reset: line; }
        .line-number { counter-increment: line; width: 2em; display: inline-block; text-align: right;
          padding-right: 0.5em; margin-right: 0.5em; color: rgba(128, 128, 128, 0.5); border-right: 1px solid rgba(128, 128, 128, 0.4); }
        .toolbar { padding: 5px; background-color: rgba(128, 128, 128, 0.2); backdrop-filter: blur(5px); }
        .button { padding-right: 10px; padding-left: 10px; }
        .unselectable, #bmc-wbtn { -webkit-user-select: none; user-select: none; }
        pre { padding: 0; margin: 0; }
      </style>
    </head>
    <body>
      <div class="toolbar unselectable">
        <label class='button'><input type="checkbox" id="wrap-toggle" /> Wrap</label>
        <label class='button'><input type="checkbox" id="sticky-toggle" /> Sticky</label>
        <label class='button'>Theme <select id="theme-select">
          ${themeHtml}
        </select></label>
      </div>
      <pre><code id="xml-code" class=hljs>${highlightXml(content)}</code></pre>
      <script>
        const vscode = acquireVsCodeApi();
        const codeElement = document.getElementById('xml-code');
        const wrapToggle = document.getElementById('wrap-toggle');
        const stickyToggle = document.getElementById('sticky-toggle');
        const themeSelect = document.getElementById('theme-select');

        wrapToggle.addEventListener('change', (e) => {
          codeElement.style.whiteSpace = e.target.checked ? 'pre-wrap' : 'pre';
          vscode.postMessage({
            command: 'wrapChanged',
            wrap: e.target.checked
          });
        });

        stickyToggle.addEventListener('change', (e) => {
          vscode.postMessage({
            command: 'stickyChanged',
            sticky: e.target.checked
          });
        });

        themeSelect.addEventListener('change', (e) => {
          const theme = e.target.value;
          const link = document.querySelector('link[rel="stylesheet"]');
          link.href = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/"+theme+".min.css";

          // send message to the mothership
          vscode.postMessage({
            command: 'themeChanged',
            theme: theme
          });
        });

        // initial theme
        themeSelect.value = '${theme}';
        wrapToggle.checked = ${wrap};
        stickyToggle.checked = ${sticky};
        codeElement.style.whiteSpace = "${wrap ? 'pre-wrap' : 'pre'}";
      </script>

      ${bmc}
    </body>
    </html>`;
}

function highlightXml(code) {
  const highlightedCode = hljs.highlight(code, { language: 'xml' }).value;
  const lines = highlightedCode.split('\n');
  return lines.map((line, index) => 
    `<span class="line-number unselectable">${index + 1}</span>${line}`
  ).join('\n');
}

function getThemesHtml() {
  let themeHtml = `<option value="default">default</option>
  <option disabled> ─────── </option>
  `;
  getThemes().forEach((aTheme) => {
    if (aTheme === 'default') {
      return;
    }
    themeHtml += `<option value="${aTheme}">${aTheme}</option>`;
  });
  return themeHtml;
}

function getThemes() {
  // path to the highlight.js styles directory
  const stylesDir = path.join(__dirname, 'node_modules', 'highlight.js', 'styles');

  try {
    const files = fs.readdirSync(stylesDir);

    // de-dup
    const themesSet = new Set();

    files.forEach(file => {
      if (file.endsWith('.css')) {
        let themeName = path.basename(file, '.css');
        themeName = themeName.replace(/\.min$/, '');  // remove `.min`
        themesSet.add(themeName);
      }
    });

    // Convert Set to Array and sort alphabetically
    return Array.from(themesSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  } catch (err) {
    console.error(`error reading styles directory ${stylesDir}:`, err);
    return [];
  }
}

module.exports = {
  activate,
  deactivate
}
