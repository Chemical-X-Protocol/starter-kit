export const sendJson = (res, status, payload, extraHeaders = {}, afterSend = null) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(payload));
  if (afterSend) afterSend();
  return res;
};

export const runRoute = (handler) => {
  try { return [handler(), null]; } catch (err) { return [null, err]; }
};
