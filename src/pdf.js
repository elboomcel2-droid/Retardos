// Convierte el reporte HTML a PDF con el navegador instalado (Edge o Chrome)
// en modo invisible. No requiere internet ni programas adicionales.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CANDIDATES = [
  process.env.PDF_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findBrowser() {
  return CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

async function htmlToPdf(html) {
  const browser = findBrowser();
  if (!browser) {
    const e = new Error('No se encontró Edge ni Chrome en este equipo para crear el PDF. Use "Imprimir" y elija "Guardar como PDF".');
    e.status = 400;
    throw e;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporte-'));
  const htmlFile = path.join(dir, 'reporte.html');
  const pdfFile = path.join(dir, 'reporte.pdf');
  fs.writeFileSync(htmlFile, html);
  try {
    await new Promise((resolve, reject) => {
      execFile(
        browser,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-first-run',
          '--no-pdf-header-footer',
          `--user-data-dir=${path.join(dir, 'perfil')}`,
          `--print-to-pdf=${pdfFile}`,
          `file:///${htmlFile.replace(/\\/g, '/')}`,
        ],
        { timeout: 90000, windowsHide: true },
        (err) => (err && !fs.existsSync(pdfFile) ? reject(err) : resolve())
      );
    });
    if (!fs.existsSync(pdfFile)) throw new Error('No se pudo crear el PDF.');
    return fs.readFileSync(pdfFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { htmlToPdf, findBrowser };
