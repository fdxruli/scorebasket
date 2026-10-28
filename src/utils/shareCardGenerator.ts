// src/utils/shareCardGenerator.ts
import { db } from '../db/db';
import { formatPeriodLabel } from './matchHelpers';

export interface ShareMatchCardInput {
  mode: 'traditional' | 'race' | 'best-of-series';
  dateStr: string;
  localName: string;
  visitorName: string;
  mainLocalScore: number;
  mainVisitorScore: number;
  scoreUnitLabel: string; // ej. 'FINAL', 'JUEGOS', 'SETS'
  periodHeaders: string[]; // ej. ['Q1', 'Q2', 'Q3', 'Q4'] o ['Set 1', 'Set 2'] o ['Juego 1', 'Juego 2']
  periodStats: { label: string; local: number; visitor: number }[];
  totalHeader: string; // 'Total', 'Ganados', 'Sets'
  localTotalCell: number;
  visitorTotalCell: number;
  localPlayers: { name: string; number?: number; points: number; fouls: number }[];
  visitorPlayers: { name: string; number?: number; points: number; fouls: number }[];
}

const CANVAS_W = 1080;
const CANVAS_H = 1350;
const PAD_X = 64;
const CONTENT_W = CANVAS_W - PAD_X * 2; // 952

const FONT_DISPLAY = '"Barlow Condensed", system-ui, -apple-system, sans-serif';
const FONT_SANS = '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
const FONT_MONO = '"JetBrains Mono", monospace';

/**
 * Dibuja un rectángulo con bordes redondeados compatible con todos los navegadores.
 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Trunca un texto con '...' si supera el ancho máximo en el contexto actual.
 */
function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const clean = (text || '').trim();
  if (!clean) return '';
  if (ctx.measureText(clean).width <= maxWidth) return clean;

  const ellipsis = '…';
  let low = 0;
  let high = clean.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = clean.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return clean.slice(0, Math.max(1, low)) + ellipsis;
}

/**
 * Resume los periodos a un máximo de 7 columnas para que la tabla siempre luzca limpia.
 */
function summarizePeriods(
  periodStats: { label: string; local: number; visitor: number }[],
  periodHeaders: string[]
): { label: string; local: number; visitor: number }[] {
  const normalized = periodStats.map((p, idx) => ({
    label: p.label || periodHeaders[idx] || `P${idx + 1}`,
    local: p.local,
    visitor: p.visitor
  }));

  if (normalized.length <= 7) {
    return normalized;
  }

  // Mostrar los primeros 5, una columna resumida para los intermedios y el último periodo
  const firstFive = normalized.slice(0, 5);
  const middle = normalized.slice(5, normalized.length - 1);
  const lastOne = normalized[normalized.length - 1];

  const middleSummary = {
    label: `+${middle.length}`,
    local: middle.reduce((acc, item) => acc + item.local, 0),
    visitor: middle.reduce((acc, item) => acc + item.visitor, 0)
  };

  return [...firstFive, middleSummary, lastOne];
}

/**
 * Genera el Blob PNG (1080x1350) del póster oficial de resultado y MVP.
 */
export async function generateMatchShareCardBlob(input: ShareMatchCardInput): Promise<Blob> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Continuar con fuentes del sistema si falla la promesa de fuentes
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo inicializar el contexto 2D del Canvas.');
  }

  // =========================================================================
  // 1. FONDO COURTSIDE PRO + HALOS RADIALES + GRILLA TÁCTICA
  // =========================================================================
  ctx.fillStyle = '#07080c';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Halo Azul Eléctrico (Local - Izquierda)
  const localHalo = ctx.createRadialGradient(210, 260, 20, 210, 260, 560);
  localHalo.addColorStop(0, 'rgba(14, 165, 233, 0.22)');
  localHalo.addColorStop(0.6, 'rgba(14, 165, 233, 0.06)');
  localHalo.addColorStop(1, 'rgba(14, 165, 233, 0)');
  ctx.fillStyle = localHalo;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Halo Naranja Básquetbol (Visitante - Derecha)
  const visitorHalo = ctx.createRadialGradient(870, 260, 20, 870, 260, 560);
  visitorHalo.addColorStop(0, 'rgba(255, 95, 31, 0.22)');
  visitorHalo.addColorStop(0.6, 'rgba(255, 95, 31, 0.06)');
  visitorHalo.addColorStop(1, 'rgba(255, 95, 31, 0)');
  ctx.fillStyle = visitorHalo;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Halo inferior sutil dorado
  const bottomHalo = ctx.createRadialGradient(540, 1020, 30, 540, 1020, 580);
  bottomHalo.addColorStop(0, 'rgba(245, 158, 11, 0.07)');
  bottomHalo.addColorStop(1, 'rgba(245, 158, 11, 0)');
  ctx.fillStyle = bottomHalo;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Grilla táctica tenue
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.024)';
  ctx.lineWidth = 1;
  const gridStep = 54;
  for (let x = gridStep; x < CANVAS_W; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS_H);
    ctx.stroke();
  }
  for (let y = gridStep; y < CANVAS_H; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_W, y);
    ctx.stroke();
  }

  // Círculo central de cancha decorativo tenue
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(CANVAS_W / 2, 310, 220, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Marco exterior tipo broadcast
  ctx.save();
  roundRectPath(ctx, 28, 28, CANVAS_W - 56, CANVAS_H - 56, 28);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // =========================================================================
  // 2. HEADER DE MARCA
  // =========================================================================
  const headerY = 62;

  // Píldora de marca izquierda
  ctx.save();
  roundRectPath(ctx, PAD_X, headerY, 370, 44, 12);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Punto naranja/azul de marca
  ctx.beginPath();
  ctx.arc(PAD_X + 22, headerY + 22, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ff5f1f';
  ctx.fill();

  ctx.font = `800 22px ${FONT_DISPLAY}`;
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('SCOREBASKET // COURTSIDE PRO', PAD_X + 38, headerY + 23);
  ctx.restore();

  // Píldora de modalidad al centro
  const modeLabel =
    input.mode === 'best-of-series'
      ? 'SERIE PLAYOFFS'
      : input.mode === 'race'
        ? 'RETA / RACE TO SCORE'
        : 'TRADICIONAL';

  const modeColor =
    input.mode === 'best-of-series'
      ? '#a855f7'
      : input.mode === 'race'
        ? '#ff5f1f'
        : '#0ea5e9';

  ctx.save();
  ctx.font = `800 19px ${FONT_DISPLAY}`;
  const modePillW = Math.max(150, ctx.measureText(modeLabel).width + 36);
  const modePillX = PAD_X + 384;
  roundRectPath(ctx, modePillX, headerY + 4, modePillW, 36, 18);
  ctx.fillStyle = `${modeColor}22`;
  ctx.fill();
  ctx.strokeStyle = `${modeColor}77`;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(modeLabel, modePillX + modePillW / 2, headerY + 23);
  ctx.restore();

  // Fecha a la derecha
  ctx.save();
  ctx.font = `700 18px ${FONT_SANS}`;
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const cleanDate = truncateText(ctx, (input.dateStr || '').toUpperCase(), 340);
  ctx.fillText(cleanDate, CANVAS_W - PAD_X, headerY + 22);
  ctx.restore();

  // Línea divisoria superior
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_X, 126);
  ctx.lineTo(CANVAS_W - PAD_X, 126);
  ctx.stroke();
  ctx.restore();

  // =========================================================================
  // 3. BLOQUE JUMBOTRON DE MARCADOR PRINCIPAL
  // =========================================================================
  const jumboY = 148;
  const jumboH = 286;
  const cardW = 434;
  const localCardX = PAD_X;
  const visitorCardX = CANVAS_W - PAD_X - cardW;

  const localWon = input.mainLocalScore > input.mainVisitorScore;
  const visitorWon = input.mainVisitorScore > input.mainLocalScore;
  const isTied = input.mainLocalScore === input.mainVisitorScore;

  const drawTeamJumboCard = (
    x: number,
    y: number,
    w: number,
    h: number,
    sideLabel: string,
    teamName: string,
    score: number,
    accentHex: string,
    accentRgb: string,
    isWinner: boolean,
    tied: boolean
  ) => {
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 24);

    const cardGrad = ctx.createLinearGradient(x, y, x, y + h);
    cardGrad.addColorStop(0, `rgba(${accentRgb}, 0.16)`);
    cardGrad.addColorStop(0.55, 'rgba(15, 19, 30, 0.95)');
    cardGrad.addColorStop(1, 'rgba(10, 12, 20, 0.98)');
    ctx.fillStyle = cardGrad;
    ctx.fill();

    ctx.strokeStyle = isWinner ? '#10b981' : `rgba(${accentRgb}, 0.45)`;
    ctx.lineWidth = isWinner ? 2.5 : 1.5;
    ctx.stroke();

    // Franja superior de color del equipo
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 24);
    ctx.clip();
    ctx.fillStyle = isWinner ? '#10b981' : accentHex;
    ctx.fillRect(x, y, w, 7);
    ctx.restore();

    // Etiqueta LOCAL / VISITANTE
    ctx.font = `800 18px ${FONT_DISPLAY}`;
    ctx.fillStyle = accentHex;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(sideLabel, x + 26, y + 36);

    // Badge GANADOR o EMPATE
    if (isWinner || tied) {
      const badgeText = isWinner ? '★ GANADOR' : 'EMPATE';
      const badgeBg = isWinner ? 'rgba(16, 185, 129, 0.22)' : 'rgba(245, 158, 11, 0.2)';
      const badgeStroke = isWinner ? '#10b981' : '#f59e0b';
      const badgeColor = isWinner ? '#34d399' : '#fbbf24';

      ctx.font = `800 17px ${FONT_DISPLAY}`;
      const bw = ctx.measureText(badgeText).width + 26;
      const bx = x + w - bw - 22;
      const by = y + 20;

      roundRectPath(ctx, bx, by, bw, 30, 15);
      ctx.fillStyle = badgeBg;
      ctx.fill();
      ctx.strokeStyle = badgeStroke;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = badgeColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, bx + bw / 2, by + 16);
    }

    // Nombre del equipo truncado limpiamente
    ctx.font = `800 42px ${FONT_DISPLAY}`;
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cleanName = truncateText(ctx, (teamName || sideLabel).toUpperCase(), w - 44);
    ctx.fillText(cleanName, x + w / 2, y + 90);

    // Número gigante de marcador en JetBrains Mono
    const scoreStr = String(score);
    const fontSize = scoreStr.length >= 3 ? 104 : 124;
    ctx.font = `800 ${fontSize}px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (isWinner) {
      ctx.shadowColor = 'rgba(16, 185, 129, 0.45)';
      ctx.shadowBlur = 26;
      ctx.fillStyle = '#10b981';
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#f8fafc';
    }
    ctx.fillText(scoreStr, x + w / 2, y + 198);
    ctx.restore();
  };

  drawTeamJumboCard(
    localCardX,
    jumboY,
    cardW,
    jumboH,
    'LOCAL',
    input.localName || 'Local',
    input.mainLocalScore,
    '#38bdf8',
    '14, 165, 233',
    localWon,
    isTied
  );

  drawTeamJumboCard(
    visitorCardX,
    jumboY,
    cardW,
    jumboH,
    'VISITANTE',
    input.visitorName || 'Visitante',
    input.mainVisitorScore,
    '#ff8c5a',
    '255, 95, 31',
    visitorWon,
    isTied
  );

  // Insignia central VS + unidad de marcador (FINAL / JUEGOS / SETS)
  ctx.save();
  const centerX = CANVAS_W / 2;
  const centerY = jumboY + jumboH / 2;

  roundRectPath(ctx, centerX - 42, centerY - 52, 84, 104, 20);
  ctx.fillStyle = '#111522';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = `900 28px ${FONT_DISPLAY}`;
  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VS', centerX, centerY - 16);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.beginPath();
  ctx.moveTo(centerX - 24, centerY + 4);
  ctx.lineTo(centerX + 24, centerY + 4);
  ctx.stroke();

  ctx.font = `800 17px ${FONT_DISPLAY}`;
  ctx.fillStyle = '#94a3b8';
  const unitLabel = truncateText(ctx, (input.scoreUnitLabel || 'FINAL').toUpperCase(), 74);
  ctx.fillText(unitLabel, centerX, centerY + 26);
  ctx.restore();

  // =========================================================================
  // 4. TABLA DE DESGLOSE POR PERIODOS / SETS / JUEGOS
  // =========================================================================
  let cursorY = jumboY + jumboH + 24; // 458

  const summarizedPeriods = summarizePeriods(input.periodStats || [], input.periodHeaders || []);
  if (summarizedPeriods.length > 0) {
    const tableH = 172;
    const headerH = 48;
    const rowH = (tableH - headerH) / 2; // 62px cada fila

    ctx.save();
    roundRectPath(ctx, PAD_X, cursorY, CONTENT_W, tableH, 18);
    ctx.fillStyle = 'rgba(15, 19, 30, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Cabecera de tabla
    ctx.save();
    roundRectPath(ctx, PAD_X, cursorY, CONTENT_W, tableH, 18);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(PAD_X, cursorY, CONTENT_W, headerH);
    ctx.restore();

    const teamColW = 264;
    const totalColW = 128;
    const periodsAreaW = CONTENT_W - teamColW - totalColW;
    const periodColW = periodsAreaW / summarizedPeriods.length;

    // Textos de cabecera
    ctx.font = `800 18px ${FONT_DISPLAY}`;
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('DESGLOSE DE PARCIALES', PAD_X + 22, cursorY + headerH / 2 + 1);

    ctx.textAlign = 'center';
    summarizedPeriods.forEach((p, idx) => {
      const colCenterX = PAD_X + teamColW + idx * periodColW + periodColW / 2;
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(p.label.toUpperCase(), colCenterX, cursorY + headerH / 2 + 1);
    });

    const totalCenterX = PAD_X + CONTENT_W - totalColW / 2;
    ctx.fillStyle = '#f8fafc';
    ctx.fillText((input.totalHeader || 'TOTAL').toUpperCase(), totalCenterX, cursorY + headerH / 2 + 1);

    // Líneas horizontales de la tabla
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_X, cursorY + headerH);
    ctx.lineTo(PAD_X + CONTENT_W, cursorY + headerH);
    ctx.moveTo(PAD_X, cursorY + headerH + rowH);
    ctx.lineTo(PAD_X + CONTENT_W, cursorY + headerH + rowH);
    ctx.stroke();

    // Función auxiliar para dibujar fila de equipo
    const drawPeriodRow = (
      rowY: number,
      teamName: string,
      dotColor: string,
      values: number[],
      totalVal: number
    ) => {
      const midY = rowY + rowH / 2;

      // Indicador circular de color
      ctx.beginPath();
      ctx.arc(PAD_X + 24, midY, 5, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();

      // Nombre de equipo
      ctx.font = `700 22px ${FONT_DISPLAY}`;
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const cleanTeam = truncateText(ctx, (teamName || '').toUpperCase(), teamColW - 48);
      ctx.fillText(cleanTeam, PAD_X + 38, midY + 1);

      // Parciales
      ctx.font = `600 22px ${FONT_MONO}`;
      ctx.textAlign = 'center';
      values.forEach((v, idx) => {
        const colCenterX = PAD_X + teamColW + idx * periodColW + periodColW / 2;
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(String(v), colCenterX, midY + 1);
      });

      // Celda total destacada
      ctx.font = `800 25px ${FONT_MONO}`;
      ctx.fillStyle = dotColor;
      ctx.fillText(String(totalVal), totalCenterX, midY + 1);
    };

    drawPeriodRow(
      cursorY + headerH,
      input.localName || 'Local',
      '#38bdf8',
      summarizedPeriods.map(p => p.local),
      input.localTotalCell
    );

    drawPeriodRow(
      cursorY + headerH + rowH,
      input.visitorName || 'Visitante',
      '#ff8c5a',
      summarizedPeriods.map(p => p.visitor),
      input.visitorTotalCell
    );

    ctx.restore();
    cursorY += tableH + 22; // 652
  }

  // =========================================================================
  // 5. BLOQUE DESTACADO "MVP DEL PARTIDO" (SI HAY JUGADORES CON PUNTOS > 0)
  // =========================================================================
  const allCandidates = [
    ...(input.localPlayers || []).map(p => ({
      ...p,
      teamName: input.localName || 'Local',
      teamWon: localWon,
      side: 'local' as const
    })),
    ...(input.visitorPlayers || []).map(p => ({
      ...p,
      teamName: input.visitorName || 'Visitante',
      teamWon: visitorWon,
      side: 'visitor' as const
    }))
  ].filter(p => p.points > 0);

  allCandidates.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (a.teamWon !== b.teamWon) return Number(b.teamWon) - Number(a.teamWon);
    return a.fouls - b.fouls;
  });

  const mvp = allCandidates[0] || null;

  if (mvp) {
    const mvpH = 142;
    ctx.save();
    roundRectPath(ctx, PAD_X, cursorY, CONTENT_W, mvpH, 20);

    const mvpGrad = ctx.createLinearGradient(PAD_X, cursorY, PAD_X + CONTENT_W, cursorY + mvpH);
    mvpGrad.addColorStop(0, 'rgba(245, 158, 11, 0.22)');
    mvpGrad.addColorStop(0.5, 'rgba(255, 95, 31, 0.14)');
    mvpGrad.addColorStop(1, 'rgba(18, 22, 34, 0.95)');
    ctx.fillStyle = mvpGrad;
    ctx.fill();

    ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Medalla / Trofeo circular a la izquierda
    const medalX = PAD_X + 64;
    const medalY = cursorY + mvpH / 2;
    ctx.beginPath();
    ctx.arc(medalX, medalY, 38, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = `900 34px ${FONT_DISPLAY}`;
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', medalX, medalY + 2);

    // Etiqueta superior MVP DE LA CANCHA
    const infoX = PAD_X + 122;
    ctx.font = `800 18px ${FONT_DISPLAY}`;
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('★ MVP DE LA CANCHA // JUGADOR MÁS VALIOSO', infoX, cursorY + 34);

    // Dorsal + Nombre del jugador MVP
    const jerseyStr = mvp.number !== undefined && mvp.number !== null ? `#${mvp.number}` : '#--';
    ctx.font = `800 28px ${FONT_MONO}`;
    ctx.fillStyle = '#fde68a';
    ctx.fillText(jerseyStr, infoX, cursorY + 74);
    const jerseyW = ctx.measureText(jerseyStr).width;

    ctx.font = `800 36px ${FONT_DISPLAY}`;
    ctx.fillStyle = '#ffffff';
    const cleanMvpName = truncateText(ctx, mvp.name.toUpperCase(), 450 - jerseyW);
    ctx.fillText(cleanMvpName, infoX + jerseyW + 16, cursorY + 74);

    // Equipo del MVP
    const teamTagColor = mvp.side === 'local' ? '#38bdf8' : '#ff8c5a';
    ctx.font = `700 18px ${FONT_SANS}`;
    ctx.fillStyle = teamTagColor;
    const cleanMvpTeam = truncateText(ctx, `EQUIPO: ${mvp.teamName.toUpperCase()}`, 460);
    ctx.fillText(cleanMvpTeam, infoX, cursorY + 112);

    // Caja derecha con línea estadística del MVP (XX PTS · X FAL)
    const statBoxW = 248;
    const statBoxH = 102;
    const statBoxX = PAD_X + CONTENT_W - statBoxW - 20;
    const statBoxY = cursorY + (mvpH - statBoxH) / 2;

    roundRectPath(ctx, statBoxX, statBoxY, statBoxW, statBoxH, 14);
    ctx.fillStyle = 'rgba(7, 8, 12, 0.65)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.font = `800 44px ${FONT_MONO}`;
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${mvp.points} PTS`, statBoxX + statBoxW / 2, statBoxY + 40);

    ctx.font = `700 17px ${FONT_MONO}`;
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(
      `${mvp.points} PTS · ${mvp.fouls} FAL`,
      statBoxX + statBoxW / 2,
      statBoxY + 78
    );

    ctx.restore();
    cursorY += mvpH + 24; // 818
  }

  // =========================================================================
  // 6. SECCIÓN "MEJORES ANOTADORES (TOP SCORERS)" O "RESUMEN DE DUELO"
  // =========================================================================
  const hasIndividualPlayers =
    (input.localPlayers && input.localPlayers.length > 0) ||
    (input.visitorPlayers && input.visitorPlayers.length > 0);

  const footerTopY = 1272;

  if (hasIndividualPlayers) {
    // Título de sección
    ctx.save();
    ctx.font = `800 22px ${FONT_DISPLAY}`;
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('MEJORES ANOTADORES // TOP SCORERS (TOP 4)', PAD_X, cursorY + 12);
    ctx.restore();

    const colsTopY = cursorY + 34;
    const availableH = Math.min(390, footerTopY - colsTopY - 18);
    const colW = (CONTENT_W - 28) / 2; // 462px

    const drawTopScorersColumn = (
      colX: number,
      teamName: string,
      playersList: { name: string; number?: number; points: number; fouls: number }[],
      accentHex: string,
      accentRgb: string
    ) => {
      ctx.save();
      roundRectPath(ctx, colX, colsTopY, colW, availableH, 18);
      ctx.fillStyle = 'rgba(15, 19, 30, 0.9)';
      ctx.fill();
      ctx.strokeStyle = `rgba(${accentRgb}, 0.35)`;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Header de columna
      const colHeaderH = 52;
      ctx.save();
      roundRectPath(ctx, colX, colsTopY, colW, availableH, 18);
      ctx.clip();
      ctx.fillStyle = `rgba(${accentRgb}, 0.14)`;
      ctx.fillRect(colX, colsTopY, colW, colHeaderH);
      ctx.restore();

      ctx.font = `800 22px ${FONT_DISPLAY}`;
      ctx.fillStyle = accentHex;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const cleanHeaderTeam = truncateText(ctx, (teamName || 'Equipo').toUpperCase(), colW - 150);
      ctx.fillText(cleanHeaderTeam, colX + 20, colsTopY + colHeaderH / 2 + 1);

      ctx.font = `800 15px ${FONT_MONO}`;
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText('FAL', colX + colW - 96, colsTopY + colHeaderH / 2 + 1);
      ctx.fillText('PTS', colX + colW - 40, colsTopY + colHeaderH / 2 + 1);

      const top4 = [...(playersList || [])]
        .sort((a, b) => b.points - a.points || a.fouls - b.fouls)
        .slice(0, 4);

      if (top4.length === 0) {
        ctx.font = `600 18px ${FONT_SANS}`;
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          'Sin estadísticas individuales',
          colX + colW / 2,
          colsTopY + colHeaderH + (availableH - colHeaderH) / 2
        );
      } else {
        const rowH = Math.min(78, (availableH - colHeaderH - 12) / 4);
        top4.forEach((player, idx) => {
          const rY = colsTopY + colHeaderH + idx * rowH;
          const midY = rY + rowH / 2;

          if (idx > 0) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(colX + 16, rY);
            ctx.lineTo(colX + colW - 16, rY);
            ctx.stroke();
          }

          // Dorsal badge
          const numBadgeW = 52;
          const numBadgeH = 36;
          roundRectPath(ctx, colX + 18, midY - numBadgeH / 2, numBadgeW, numBadgeH, 8);
          ctx.fillStyle = `rgba(${accentRgb}, 0.16)`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${accentRgb}, 0.4)`;
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.font = `800 18px ${FONT_MONO}`;
          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const numTxt =
            player.number !== undefined && player.number !== null ? `#${player.number}` : '-';
          ctx.fillText(numTxt, colX + 18 + numBadgeW / 2, midY + 1);

          // Nombre del jugador
          ctx.font = `700 20px ${FONT_SANS}`;
          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'left';
          const cleanPName = truncateText(ctx, player.name, colW - 210);
          ctx.fillText(cleanPName, colX + 82, midY + 1);

          // Faltas
          ctx.font = `700 18px ${FONT_MONO}`;
          ctx.fillStyle = player.fouls >= 5 ? '#f43f5e' : '#94a3b8';
          ctx.textAlign = 'center';
          ctx.fillText(String(player.fouls), colX + colW - 96, midY + 1);

          // Puntos
          ctx.font = `800 24px ${FONT_MONO}`;
          ctx.fillStyle = player.points > 0 ? '#10b981' : '#cbd5e1';
          ctx.fillText(String(player.points), colX + colW - 40, midY + 1);
        });
      }

      ctx.restore();
    };

    drawTopScorersColumn(
      PAD_X,
      input.localName || 'Local',
      input.localPlayers || [],
      '#38bdf8',
      '14, 165, 233'
    );

    drawTopScorersColumn(
      PAD_X + colW + 28,
      input.visitorName || 'Visitante',
      input.visitorPlayers || [],
      '#ff8c5a',
      '255, 95, 31'
    );
  } else {
    // BLOQUE ESTILIZADO "RESUMEN DE DUELO" (Cuando no hay jugadores individuales, ej. Reta Rápida)
    ctx.save();
    ctx.font = `800 22px ${FONT_DISPLAY}`;
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('RESUMEN DE DUELO // ESTADÍSTICAS GLOBALES DE CANCHA', PAD_X, cursorY + 12);

    const summaryY = cursorY + 36;
    const summaryH = Math.min(440, footerTopY - summaryY - 22);

    roundRectPath(ctx, PAD_X, summaryY, CONTENT_W, summaryH, 22);
    const panelGrad = ctx.createLinearGradient(PAD_X, summaryY, PAD_X + CONTENT_W, summaryY + summaryH);
    panelGrad.addColorStop(0, 'rgba(14, 165, 233, 0.10)');
    panelGrad.addColorStop(0.5, 'rgba(15, 19, 30, 0.94)');
    panelGrad.addColorStop(1, 'rgba(255, 95, 31, 0.10)');
    ctx.fillStyle = panelGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Calcular métricas globales del partido
    const localPtsSum =
      (input.periodStats || []).reduce((acc, p) => acc + p.local, 0) || input.mainLocalScore;
    const visitorPtsSum =
      (input.periodStats || []).reduce((acc, p) => acc + p.visitor, 0) || input.mainVisitorScore;
    const combinedPoints = localPtsSum + visitorPtsSum;
    const diffScore = Math.abs(input.mainLocalScore - input.mainVisitorScore);
    const periodsPlayed = Math.max(1, (input.periodStats || []).length);
    const periodNoun =
      input.mode === 'best-of-series'
        ? 'SETS JUGADOS'
        : input.mode === 'race'
          ? 'JUEGOS DISPUTADOS'
          : 'PERIODOS JUGADOS';

    // 3 tarjetas de métricas adentro del bloque
    const innerPad = 28;
    const metricGap = 22;
    const metricW = (CONTENT_W - innerPad * 2 - metricGap * 2) / 3;
    const metricH = 178;
    const metricY = summaryY + 28;

    const metrics = [
      {
        label: 'PUNTOS COMBINADOS',
        value: String(combinedPoints),
        sub: `${localPtsSum} Local · ${visitorPtsSum} Visita`,
        color: '#38bdf8'
      },
      {
        label: 'DIFERENCIA FINAL',
        value: diffScore === 0 ? 'EMPATE' : `+${diffScore}`,
        sub: localWon
          ? `Ventaja ${truncateText(ctx, input.localName, 140)}`
          : visitorWon
            ? `Ventaja ${truncateText(ctx, input.visitorName, 140)}`
            : 'Marcador igualado',
        color: '#10b981'
      },
      {
        label: periodNoun,
        value: String(periodsPlayed),
        sub: `Modalidad ${modeLabel}`,
        color: '#ff8c5a'
      }
    ];

    metrics.forEach((m, idx) => {
      const mX = PAD_X + innerPad + idx * (metricW + metricGap);
      roundRectPath(ctx, mX, metricY, metricW, metricH, 16);
      ctx.fillStyle = 'rgba(7, 8, 12, 0.65)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = `800 17px ${FONT_DISPLAY}`;
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.label, mX + metricW / 2, metricY + 34);

      ctx.font = `800 54px ${FONT_MONO}`;
      ctx.fillStyle = m.color;
      ctx.fillText(m.value, mX + metricW / 2, metricY + 96);

      ctx.font = `600 16px ${FONT_SANS}`;
      ctx.fillStyle = '#cbd5e1';
      const cleanSub = truncateText(ctx, m.sub, metricW - 24);
      ctx.fillText(cleanSub, mX + metricW / 2, metricY + 148);
    });

    // Barra visual de Dominio de Partido (Local vs Visitante)
    const barSectionY = metricY + metricH + 42;
    const barX = PAD_X + innerPad;
    const barW = CONTENT_W - innerPad * 2;
    const localShare = combinedPoints > 0 ? localPtsSum / combinedPoints : 0.5;
    const localPct = Math.round(localShare * 100);
    const visitorPct = 100 - localPct;

    ctx.font = `800 19px ${FONT_DISPLAY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(
      `${truncateText(ctx, input.localName.toUpperCase(), 260)} (${localPct}%)`,
      barX,
      barSectionY
    );

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ff8c5a';
    ctx.fillText(
      `(${visitorPct}%) ${truncateText(ctx, input.visitorName.toUpperCase(), 260)}`,
      barX + barW,
      barSectionY
    );

    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('BALANCE OFENSIVO DE PUNTOS', barX + barW / 2, barSectionY);

    const trackY = barSectionY + 24;
    const trackH = 26;
    roundRectPath(ctx, barX, trackY, barW, trackH, 13);
    ctx.fillStyle = 'rgba(255, 95, 31, 0.85)';
    ctx.fill();

    ctx.save();
    roundRectPath(ctx, barX, trackY, barW, trackH, 13);
    ctx.clip();
    const localFillW = Math.max(18, Math.min(barW - 18, barW * localShare));
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(barX, trackY, localFillW, trackH);
    ctx.restore();

    ctx.restore();
  }

  // =========================================================================
  // 7. FOOTER OFICIAL
  // =========================================================================
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_X, footerTopY);
  ctx.lineTo(CANVAS_W - PAD_X, footerTopY);
  ctx.stroke();

  ctx.font = `700 19px ${FONT_SANS}`;
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    'Generado con ScoreBasket · Control Oficial de Cancha',
    CANVAS_W / 2,
    footerTopY + 32
  );
  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('No se pudo generar la imagen PNG del partido.'));
        }
      },
      'image/png',
      1.0
    );
  });
}

/**
 * Descarga directamente el archivo PNG generado mediante un enlace temporal.
 */
export async function downloadMatchCardPng(input: ShareMatchCardInput): Promise<void> {
  const blob = await generateMatchShareCardBlob(input);
  triggerBlobDownload(blob, 'scorebasket-resultado.png');
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Comparte la tarjeta por Web Share API (WhatsApp nativo en Android/iOS)
 * o descarga automáticamente el PNG en caso de no estar soportado.
 */
export async function shareOrDownloadMatchCard(
  input: ShareMatchCardInput
): Promise<'shared' | 'downloaded'> {
  const blob = await generateMatchShareCardBlob(input);
  const file = new File([blob], 'scorebasket-resultado.png', { type: 'image/png' });
  const shareText = `🏀 *${input.localName} ${input.mainLocalScore} - ${input.mainVisitorScore} ${input.visitorName}* (${input.scoreUnitLabel})\n📊 Acta oficial generada con ScoreBasket`;

  const nav = typeof navigator !== 'undefined' ? navigator : undefined;

  if (nav && typeof nav.canShare === 'function' && typeof nav.share === 'function') {
    let canShareFile = false;
    try {
      canShareFile = nav.canShare({ files: [file] });
    } catch {
      canShareFile = false;
    }

    if (canShareFile) {
      try {
        await nav.share({
          title: `${input.localName} vs ${input.visitorName} · ScoreBasket`,
          text: shareText,
          files: [file]
        });
        return 'shared';
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          // Si el usuario cancela el menú nativo de compartir, no disparamos descarga innecesaria
          return 'shared';
        }
        // Si falló por otro motivo, caemos al fallback de descarga directa
      }
    }
  }

  triggerBlobDownload(blob, 'scorebasket-resultado.png');
  return 'downloaded';
}

/**
 * Construye el objeto ShareMatchCardInput consultando Dexie en tiempo real para un matchId.
 * Funciona tanto para partidos finalizados como para partidos en vivo justo en el modal de fin de juego.
 */
export async function buildShareMatchCardInputFromDb(
  matchId: number
): Promise<ShareMatchCardInput | null> {
  const match = await db.matches.get(matchId);
  if (!match) return null;

  const [localTeam, visitorTeam, scores, fouls, players] = await Promise.all([
    db.teams.get(match.localTeamId),
    db.teams.get(match.visitorTeamId),
    db.scores.where({ matchId }).toArray(),
    db.fouls.where({ matchId }).toArray(),
    db.players.where('teamId').anyOf([match.localTeamId, match.visitorTeamId]).toArray()
  ]);

  const mode = match.config?.mode || 'traditional';
  const safeScores = scores || [];
  const safeFouls = fouls || [];
  const safePlayers = players || [];

  const localPointsTotal = safeScores
    .filter(s => s.teamId === match.localTeamId)
    .reduce((a, b) => a + b.points, 0);
  const visitorPointsTotal = safeScores
    .filter(s => s.teamId === match.visitorTeamId)
    .reduce((a, b) => a + b.points, 0);

  let mainLocalScore = localPointsTotal || match.localScore || 0;
  let mainVisitorScore = visitorPointsTotal || match.visitorScore || 0;

  if (mode === 'best-of-series') {
    mainLocalScore = match.config.bestOf?.wins?.local || 0;
    mainVisitorScore = match.config.bestOf?.wins?.visitor || 0;
  }

  const quartersSet = new Set([
    ...safeScores.map(s => s.quarter),
    ...safeFouls.map(f => f.quarter)
  ]);
  const maxDataQuarter = Math.max(...Array.from(quartersSet), 0);
  const totalQuarters = match.config?.traditional?.totalQuarters || match.totalQuarters || 4;
  const maxDisplayPeriod =
    mode === 'traditional' ? Math.max(maxDataQuarter, totalQuarters) : maxDataQuarter;

  let rawPeriods: { period: number; local: number; visitor: number }[] = [];
  for (let q = 1; q <= maxDisplayPeriod; q++) {
    rawPeriods.push({
      period: q,
      local: safeScores
        .filter(s => s.teamId === match.localTeamId && s.quarter === q)
        .reduce((a, b) => a + b.points, 0),
      visitor: safeScores
        .filter(s => s.teamId === match.visitorTeamId && s.quarter === q)
        .reduce((a, b) => a + b.points, 0)
    });
  }

  // En modo race en vivo (cuando el modal de fin de partido está abierto antes de guardar gameHistory),
  // incluimos el juego actual si tiene puntaje y aún no figura en gameHistory.
  const storedHistory = [...(match.gameHistory || [])];
  const currentRaceGame = match.config?.race?.currentGame || 1;
  if (
    mode === 'race' &&
    match.status !== 'finished' &&
    ((match.localScore || 0) > 0 || (match.visitorScore || 0) > 0) &&
    !storedHistory.some(g => g.gameNumber === currentRaceGame)
  ) {
    storedHistory.push({
      gameNumber: currentRaceGame,
      localScore: match.localScore || 0,
      visitorScore: match.visitorScore || 0,
      winner: (match.localScore || 0) >= (match.visitorScore || 0) ? 'local' : 'visitor',
      finishedAt: new Date()
    });
  }

  const hasRematchesPlayed = currentRaceGame > 1 || storedHistory.length > 1;
  const isCurrentScoreZero = (match.localScore || 0) === 0 && (match.visitorScore || 0) === 0;
  const isRaceWithGames =
    mode === 'race' && storedHistory.length >= 1 && (hasRematchesPlayed || isCurrentScoreZero);

  let localTotalCell = localPointsTotal || match.localScore || 0;
  let visitorTotalCell = visitorPointsTotal || match.visitorScore || 0;
  let totalHeader = 'Total';

  if (isRaceWithGames) {
    const sortedGames = [...storedHistory].sort((a, b) => a.gameNumber - b.gameNumber);
    mainLocalScore = sortedGames.filter(g => g.winner === 'local').length;
    mainVisitorScore = sortedGames.filter(g => g.winner === 'visitor').length;
    rawPeriods = sortedGames.map(g => ({
      period: g.gameNumber,
      local: g.localScore,
      visitor: g.visitorScore
    }));
    localTotalCell = mainLocalScore;
    visitorTotalCell = mainVisitorScore;
    totalHeader = 'Ganados';
  } else if (mode === 'race' && storedHistory.length === 1 && rawPeriods.length === 0) {
    mainLocalScore = storedHistory[0].localScore;
    mainVisitorScore = storedHistory[0].visitorScore;
    rawPeriods = [
      {
        period: storedHistory[0].gameNumber,
        local: storedHistory[0].localScore,
        visitor: storedHistory[0].visitorScore
      }
    ];
    localTotalCell = mainLocalScore;
    visitorTotalCell = mainVisitorScore;
  }

  if (mode === 'best-of-series') {
    if (storedHistory.length > 0 && rawPeriods.length === 0) {
      const sortedSets = [...storedHistory].sort((a, b) => a.gameNumber - b.gameNumber);
      rawPeriods = sortedSets.map(g => ({
        period: g.gameNumber,
        local: g.localScore,
        visitor: g.visitorScore
      }));
    }
    totalHeader = 'Sets';
    localTotalCell = mainLocalScore;
    visitorTotalCell = mainVisitorScore;
  }

  const getLabel = (p: number) => {
    if (mode === 'best-of-series') return `Set ${p}`;
    if (mode === 'race') return `Juego ${p}`;
    return formatPeriodLabel(p, totalQuarters);
  };

  const periodStats = rawPeriods.map(rp => ({
    label: getLabel(rp.period),
    local: rp.local,
    visitor: rp.visitor
  }));

  const periodHeaders = periodStats.map(ps => ps.label);

  const scoreUnitLabel =
    mode === 'best-of-series' ? 'SETS' : isRaceWithGames ? 'JUEGOS' : 'FINAL';

  const buildTeamPlayerStats = (teamId: number) => {
    return safePlayers
      .filter(p => p.teamId === teamId)
      .map(p => {
        const points = safeScores
          .filter(s => s.playerId === p.id)
          .reduce((acc, curr) => acc + curr.points, 0);
        const foulsCount = safeFouls.filter(f => f.playerId === p.id).length;
        return {
          name: p.name,
          number: p.number,
          points,
          fouls: foulsCount
        };
      })
      .filter(p => p.points > 0 || p.fouls > 0)
      .sort((a, b) => b.points - a.points);
  };

  let dateStr = '';
  try {
    dateStr = new Intl.DateTimeFormat('es-MX', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(match.finishedAt || match.createdAt || new Date());
  } catch {
    dateStr = new Date().toLocaleDateString();
  }

  return {
    mode,
    dateStr,
    localName: localTeam?.name || 'Local',
    visitorName: visitorTeam?.name || 'Visitante',
    mainLocalScore,
    mainVisitorScore,
    scoreUnitLabel,
    periodHeaders,
    periodStats,
    totalHeader,
    localTotalCell,
    visitorTotalCell,
    localPlayers: buildTeamPlayerStats(match.localTeamId),
    visitorPlayers: buildTeamPlayerStats(match.visitorTeamId)
  };
}
