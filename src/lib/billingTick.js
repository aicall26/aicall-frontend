/**
 * Heartbeat de billing in timpul apelului.
 * Frontend trimite tick la backend la fiecare 15s.
 * Primeste inapoi credit + flag-uri warn_15min/warn_5min/must_end.
 */
import { api } from './api.js';
import { setCreditFromTick } from './credit.js';

let tickInterval = null;
let currentSessionId = null;
let secondsSinceLastTick = 0;
let onWarning15 = null;
let onWarning5 = null;
let onMustEnd = null;

const TICK_INTERVAL_MS = 15000;

export function startBilling(sessionId, callbacks = {}) {
  stopBilling();
  currentSessionId = sessionId;
  secondsSinceLastTick = 0;
  onWarning15 = callbacks.onWarning15 || null;
  onWarning5 = callbacks.onWarning5 || null;
  onMustEnd = callbacks.onMustEnd || null;

  tickInterval = setInterval(async () => {
    if (!currentSessionId) return;
    secondsSinceLastTick = 15;
    try {
      const result = await api.post('/api/calls/tick', {
        session_id: currentSessionId,
        seconds: secondsSinceLastTick,
      });
      if (typeof result.credit_cents === 'number') {
        setCreditFromTick(result.credit_cents, result.minutes_remaining);
      }
      if (result.warn_15min && onWarning15) onWarning15();
      if (result.warn_5min && onWarning5) onWarning5();
      if (result.must_end && onMustEnd) onMustEnd();
    } catch (e) {
      console.error('Billing tick failed:', e);
    }
  }, TICK_INTERVAL_MS);
}

export function stopBilling(finalSeconds = 0) {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  const sessionId = currentSessionId;
  currentSessionId = null;

  if (sessionId) {
    api.post('/api/calls/end', {
      session_id: sessionId,
      final_seconds: finalSeconds,
    }).catch(e => console.error('Call end failed:', e));
  }
}

export function getActiveBillingSession() {
  return currentSessionId;
}
