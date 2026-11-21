/**
 * <xo-savings-dialog v-model />: the token savings certificate (#7641), drawn only from GET /api/savings, which reads the
 * tool_calls ledger with the accounting of `chemx report savings`. The headline is measured gross savings; the net
 * figure and the method sit beside it, so the certificate never claims more than the ledger shows. PNG download.
 */
(() => {
  const fmt = (n) => Math.round(Number(n) || 0).toLocaleString();
  const day = (ms) => (Number(ms) > 0 ? new Date(Number(ms)).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '');

  const drawCertificate = (canvas, s) => {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, w, h);
    const band = ctx.createLinearGradient(0, 0, w, 0);
    band.addColorStop(0, '#62c9ff'); band.addColorStop(1, '#a78bfa');
    ctx.fillStyle = band; ctx.fillRect(0, 0, w, 5);
    ctx.fillStyle = '#a3abb8'; ctx.font = '600 13px Inter, sans-serif';
    ctx.fillText('CHEMICAL X · MEASURED TOKEN SAVINGS', 28, 40);
    ctx.fillStyle = '#f7f8fa'; ctx.font = '700 40px Inter, sans-serif';
    ctx.fillText(fmt(s.totals.grossSavedTokens) + ' tokens', 28, 92);
    ctx.fillStyle = '#a3abb8'; ctx.font = '400 14px Inter, sans-serif';
    ctx.fillText(fmt(s.totals.measured) + ' measured calls returned ' + fmt(s.totals.measuredReturnedTokens) + ' tokens instead of ' + fmt(s.totals.counterfactualTokens), 28, 122);
    ctx.fillText('Net across all ' + fmt(s.totals.calls) + ' logged calls: ' + fmt(s.totals.netSavedTokens) + ' tokens', 28, 146);
    ctx.fillStyle = '#6b7484'; ctx.font = '400 12px Inter, sans-serif';
    ctx.fillText('From the tool_calls ledger, ' + day(s.since) + ' to ' + day(s.until) + '. Tokens estimated as characters / 4.', 28, h - 24);
  };

  window.ChemxUi.components['xo-savings-dialog'] = {
    props: { modelValue: { type: Boolean, default: false } },
    emits: ['update:modelValue'],
    setup(props) {
      const { ref, watch, nextTick } = Vue;
      const data = ref(null);
      const error = ref('');
      const canvas = ref(null);
      const load = async () => {
        error.value = '';
        try {
          data.value = await window.ChemxUi.getJson('/api/savings');
          await nextTick();
          const canDraw = Boolean(canvas.value) && Boolean(data.value?.hasData);
          if (canDraw) drawCertificate(canvas.value, data.value);
        } catch (err) {
          error.value = 'Could not load the savings ledger (' + err.message + ').';
        }
      };
      watch(() => props.modelValue, (isOpen) => { if (isOpen) load(); });
      const download = () => {
        const hasCanvas = Boolean(canvas.value);
        if (!hasCanvas) return;
        const link = document.createElement('a');
        link.download = 'chemx-token-savings.png';
        link.href = canvas.value.toDataURL('image/png');
        link.click();
      };
      return { data, error, canvas, download, fmt, day };
    },
    template: `
      <v-dialog :model-value="modelValue" max-width="640" @update:model-value="$emit('update:modelValue', $event)">
        <v-card class="xo-cert">
          <header class="xo-cert__head">
            <div><div class="x-eyebrow">Token savings</div><h2 class="xo-cert__title">Measured on this board</h2></div>
            <v-btn icon="mdi-close" variant="text" size="small" aria-label="Close" @click="$emit('update:modelValue', false)" />
          </header>
          <div class="xo-cert__body">
            <p v-if="error" class="x-muted">{{ error }}</p>
            <div v-else-if="!data" class="x-empty">Loading the ledger…</div>
            <div v-else-if="!data.hasData" class="x-empty">No chemx calls are logged on this board yet, so there is nothing to measure.</div>
            <template v-else>
              <div class="xo-cert__kpis">
                <div class="xo-cert__kpi"><span>Saved on measured calls</span><b class="x-num">{{ fmt(data.totals.grossSavedTokens) }}</b><small>tokens</small></div>
                <div class="xo-cert__kpi"><span>Net across all calls</span><b class="x-num" :class="{ 'is-neg': data.totals.netSavedTokens < 0 }">{{ fmt(data.totals.netSavedTokens) }}</b><small>tokens</small></div>
                <div class="xo-cert__kpi"><span>Calls logged</span><b class="x-num">{{ fmt(data.totals.calls) }}</b><small>{{ fmt(data.totals.measured) }} measured</small></div>
              </div>
              <canvas ref="canvas" class="xo-cert__canvas" width="1200" height="400" aria-label="Savings certificate image" />
              <div v-if="data.topActions.length" class="xo-cert__actions">
                <div class="x-eyebrow">Where it comes from</div>
                <div v-for="a in data.topActions" :key="a.action" class="xo-cert__row">
                  <code>{{ a.action }}</code><span class="x-muted x-num">{{ fmt(a.measured) }} calls</span>
                  <span class="x-num">{{ fmt(a.measuredResultTokens) }} vs {{ fmt(a.counterfactualTokens) }}</span>
                  <b class="x-num">−{{ fmt(a.savedTokens) }}</b>
                </div>
              </div>
              <p class="xo-cert__method">
                Gross counts only calls where chemx recorded the native alternative: the whole file an outline or symbol read replaced,
                or the raw output a summary replaced. Net subtracts every token returned by calls with no recorded alternative, so it can
                be negative. Tokens are characters ÷ 4. Logged {{ day(data.since) }} to {{ day(data.until) }}. Same method as
                <code>chemx report savings</code>.
              </p>
            </template>
          </div>
          <footer class="xo-cert__foot">
            <v-btn v-if="data && data.hasData" variant="tonal" color="primary" prepend-icon="mdi-download" @click="download">Download PNG</v-btn>
            <v-spacer />
            <v-btn variant="text" @click="$emit('update:modelValue', false)">Close</v-btn>
          </footer>
        </v-card>
      </v-dialog>`
  };
})();
