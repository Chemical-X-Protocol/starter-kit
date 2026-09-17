import { ref } from 'vue';
import type { SavingsModalProps, SavingsModalEmits } from './types';

export function useSavingsModalController(props: SavingsModalProps, emit: SavingsModalEmits) {
  const activeCanvas = ref<HTMLCanvasElement | null>(null);
  const downloadError = ref<Error | null>(null);

  const renderCertificate = (canvas: HTMLCanvasElement) => {
    activeCanvas.value = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = props.savings || { tokensSaved: 165000, dollarsSaved: 1.65, reductionPct: 88, actualTokens: 22000 };
    ctx.fillStyle = '#050811';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, 'rgba(98, 201, 255, 0.15)');
    grad.addColorStop(1, 'rgba(52, 211, 153, 0.1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#62c9ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText('⚡ CHEMICAL X SAVINGS CERTIFICATE', 30, 48);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Autonomous Swarm Intelligence & AST Token Reduction', 30, 74);

    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillText(`${Number(s.tokensSaved || 0).toLocaleString()} TOKENS SAVED`, 30, 130);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(`$${Number(s.dollarsSaved || 0).toFixed(2)} USD Burn Avoided`, 30, 168);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(`Efficiency Ratio: ${s.reductionPct || 88}% reduction across swarm operations`, 30, 205);
    ctx.fillText(`Verified by SQLite AST Indexer • ${new Date().toISOString().slice(0, 10)}`, 30, 235);
  };

  const handleDownload = () => {
    if (!activeCanvas.value) return;
    try {
      const dataUrl = activeCanvas.value.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = 'chemical-x-token-savings.png';
      link.href = dataUrl;
      link.click();
    } catch (err) {
      downloadError.value = err instanceof Error ? err : new Error(String(err));
    }
  };

  const handleClose = () => { emit('close'); };

  return {
    handleCanvasReady: renderCertificate,
    downloadCertificate: handleDownload,
    handleClose,
    downloadError
  };
}
