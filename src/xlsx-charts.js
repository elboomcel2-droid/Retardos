// Agrega gráficas nativas de Excel (DrawingML) a un .xlsx generado con exceljs,
// que no sabe crearlas. Cada gráfica apunta a celdas reales de la hoja, así
// que en Excel se pueden copiar, editar y se actualizan si cambian los datos.
const JSZip = require('jszip');

const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const INK = '52514E';
const GRID = 'E1E0D9';
const AXIS = 'C3C2B7';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fill = (hex) => `<a:solidFill><a:srgbClr val="${hex.replace('#', '').toUpperCase()}"/></a:solidFill>`;
const font = (sz, color = INK, bold = false) =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${bold ? 1 : 0}">${fill(color)}<a:latin typeface="Segoe UI"/></a:defRPr></a:pPr><a:endParaRPr lang="es-MX"/></a:p></c:txPr>`;

function strCache(ref, values) {
  return `<c:strRef><c:f>${xml(ref)}</c:f><c:strCache><c:ptCount val="${values.length}"/>${values
    .map((v, i) => `<c:pt idx="${i}"><c:v>${xml(v)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`;
}
function numCache(ref, values) {
  return `<c:numRef><c:f>${xml(ref)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values
    .map((v, i) => (v == null ? '' : `<c:pt idx="${i}"><c:v>${Number(v)}</c:v></c:pt>`)).join('')}</c:numCache></c:numRef>`;
}

/**
 * chart = {
 *   title, dir: 'col' | 'bar', stacked?: bool, max?: number, legend?: bool,
 *   cats: { ref, values }, series: [{ name, color, ref, values, pointColors? }],
 * }
 */
function chartXml(ch) {
  const horizontal = ch.dir === 'bar';
  const grouping = ch.stacked ? 'stacked' : 'clustered';
  const ser = ch.series
    .map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${xml(s.name)}</c:v></c:tx>
      <c:spPr>${fill(s.color)}<a:ln><a:noFill/></a:ln></c:spPr><c:invertIfNegative val="0"/>
      ${(s.pointColors || []).map((col, p) => `<c:dPt><c:idx val="${p}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr>${fill(col)}</c:spPr></c:dPt>`).join('')}
      <c:dLbls>${ch.stacked ? '<c:numFmt formatCode="0;;;" sourceLinked="0"/>' : ''}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${font(900, '0B0B0B')}
        <c:dLblPos val="${ch.stacked ? 'ctr' : 'outEnd'}"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>
      <c:cat>${strCache(ch.cats.ref, ch.cats.values)}</c:cat><c:val>${numCache(s.ref, s.values)}</c:val></c:ser>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/>
<c:chart>
  <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="es-MX" sz="1200" b="1">${fill('0B0B0B')}<a:latin typeface="Segoe UI"/></a:rPr><a:t>${xml(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
  <c:autoTitleDeleted val="0"/>
  <c:plotArea><c:layout/>
    <c:barChart><c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${ser}
      <c:gapWidth val="${horizontal ? 50 : 60}"/>${ch.stacked ? '<c:overlap val="100"/>' : ''}<c:axId val="5001"/><c:axId val="5002"/></c:barChart>
    <c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/>
      <c:axPos val="${horizontal ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/>
      <c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525">${fill(AXIS)}</a:ln></c:spPr>${font(900)}<c:crossAx val="5002"/><c:crosses val="autoZero"/>
      <c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>
    <c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/>${ch.max != null ? `<c:max val="${ch.max}"/>` : ''}<c:min val="0"/></c:scaling><c:delete val="0"/>
      <c:axPos val="${horizontal ? 'b' : 'l'}"/><c:majorGridlines><c:spPr><a:ln w="6350">${fill(GRID)}</a:ln></c:spPr></c:majorGridlines>
      <c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>
      <c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${font(900, '898781')}<c:crossAx val="5001"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>
    <c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
  </c:plotArea>
  ${ch.series.length > 1 || ch.legend ? `<c:legend><c:legendPos val="t"/><c:overlay val="0"/>${font(900)}</c:legend>` : ''}
  <c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>
</c:chart>
<c:spPr>${fill('FFFFFF')}<a:ln w="9525">${fill('E2E8F0')}</a:ln></c:spPr>
${font(900)}
</c:chartSpace>`;
}

function anchorXml(a, i) {
  const pt = (p) => `<xdr:col>${p.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>0</xdr:rowOff>`;
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${pt(a.from)}</xdr:from><xdr:to>${pt(a.to)}</xdr:to>
    <xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Gráfica ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
    <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
    <a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId${i + 1}"/></a:graphicData></a:graphic>
    </xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

/**
 * @param {Buffer} buffer  xlsx de exceljs
 * @param {number} sheetNo número de hoja (1 = primera)
 * @param {object[]} charts definiciones con `anchor: { from: {col,row}, to: {col,row} }` (base 0)
 */
async function addCharts(buffer, sheetNo, charts) {
  if (!charts.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const sheetPath = `xl/worksheets/sheet${sheetNo}.xml`;
  const relsPath = `xl/worksheets/_rels/sheet${sheetNo}.xml.rels`;
  let sheet = await zip.file(sheetPath).async('string');
  if (sheet.includes('<drawing ')) throw new Error('La hoja ya tiene dibujos');

  // Relación hoja → dibujo.
  let rels = zip.file(relsPath)
    ? await zip.file(relsPath).async('string')
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  const rid = 'rIdGraficas1';
  rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  zip.file(relsPath, rels);

  // <drawing> va antes de legacyDrawing/tableParts/extLst (orden del estándar).
  if (!/<worksheet[^>]*xmlns:r=/.test(sheet)) sheet = sheet.replace('<worksheet ', `<worksheet xmlns:r="${NS_R}" `);
  const tag = `<drawing r:id="${rid}"/>`;
  const m = sheet.match(/<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[\s>]/);
  sheet = m ? sheet.replace(m[0], tag + m[0]) : sheet.replace('</worksheet>', `${tag}</worksheet>`);
  zip.file(sheetPath, sheet);

  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}">${charts.map((c, i) => anchorXml(c.anchor, i)).join('')}</xdr:wsDr>`);
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${charts
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/chart" Target="../charts/chart${i + 1}.xml"/>`).join('')}</Relationships>`);
  charts.forEach((c, i) => zip.file(`xl/charts/chart${i + 1}.xml`, chartXml(c)));

  let types = await zip.file('[Content_Types].xml').async('string');
  const overrides =
    `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` +
    charts.map((_, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join('');
  types = types.replace('</Types>', `${overrides}</Types>`);
  zip.file('[Content_Types].xml', types);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { addCharts };
