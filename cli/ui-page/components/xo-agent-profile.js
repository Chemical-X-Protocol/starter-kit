/** <xo-agent-profile :agent-id="id" />: an agent's profile page at #/agents/@handle (task profiles). Stub. */
window.ChemxUi.components['xo-agent-profile'] = {
  props: { agentId: { type: String, default: '' } },
  template: `<div class="xo-glass pa-4" style="border-radius:14px;"><xo-avatar :handle="agentId" :size="48" :link="false" />
    <div class="xo-display mt-2">{{ agentId || 'Agents' }}</div><div class="xo-stub">Profile page coming in the social sprint.</div></div>`
};
