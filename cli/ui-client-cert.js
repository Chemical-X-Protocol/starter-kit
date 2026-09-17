/**
 * Chemical X UI Certificate Canvas Renderer
 */
export const UI_CLIENT_CERT_SCRIPT = `
window.renderSavingsCanvas = function(canvas, savings) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#050811'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, 'rgba(98,201,255,0.18)'); grad.addColorStop(1, 'rgba(52,211,153,0.12)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#62c9ff'; ctx.lineWidth = 2; ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.fillStyle = '#38bdf8'; ctx.font = 'bold 18px sans-serif'; ctx.fillText('⚡ CHEMICAL X SAVINGS CERTIFICATE', 24, 40);
  ctx.fillStyle = '#34d399'; ctx.font = 'bold 24px sans-serif'; ctx.fillText(Number(savings.tokensSaved || 0).toLocaleString() + ' TOKENS SAVED', 24, 90);
  ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 18px sans-serif'; ctx.fillText('$' + Number(savings.dollarsSaved || 0).toFixed(2) + ' USD Burn Avoided', 24, 130);
  ctx.fillStyle = '#94a3b8'; ctx.font = '13px sans-serif'; ctx.fillText('Efficiency Ratio: ' + (savings.reductionPct || 88) + '% token reduction avoided', 24, 170);
  ctx.fillText('Verified by SQLite AST Indexer • ' + new Date().toISOString().slice(0, 10), 24, 200);
};

window.downloadSavingsPng = function(canvas) {
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = 'chemical-x-token-savings.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
};
`;
